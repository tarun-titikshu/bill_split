"""
Ledger — a fair bill-splitting backend.

Validates a set of products and the people who bought them, then splits
any extra charge (tax, delivery, service fee, surcharge...) proportionally
based on how much each person actually spent — the same "percentage of
base spend" method used throughout this conversation.
"""

from flask import Flask, render_template, request, jsonify
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation

app = Flask(__name__)

TWO_PLACES = Decimal("0.01")


def to_money(value):
    """Round a Decimal to 2 decimal places, half-up."""
    return value.quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


class ValidationError(Exception):
    """Raised with a list of human-readable error strings."""

    def __init__(self, errors):
        super().__init__("; ".join(errors))
        self.errors = errors


def parse_positive_decimal(raw, field_label, allow_zero=False):
    if raw is None or (isinstance(raw, str) and raw.strip() == ""):
        raise ValueError(f"{field_label} is required.")
    try:
        value = Decimal(str(raw))
    except (InvalidOperation, ValueError):
        raise ValueError(f"{field_label} must be a valid number.")
    if value.is_nan() or value.is_infinite():
        raise ValueError(f"{field_label} must be a valid number.")
    if allow_zero and value < 0:
        raise ValueError(f"{field_label} cannot be negative.")
    if not allow_zero and value <= 0:
        raise ValueError(f"{field_label} must be greater than 0.")
    return value


def parse_positive_int(raw, field_label, allow_zero=False):
    if raw is None or (isinstance(raw, str) and raw.strip() == ""):
        raise ValueError(f"{field_label} is required.")
    try:
        value = int(raw)
    except (ValueError, TypeError):
        raise ValueError(f"{field_label} must be a whole number.")
    if allow_zero and value < 0:
        raise ValueError(f"{field_label} cannot be negative.")
    if not allow_zero and value <= 0:
        raise ValueError(f"{field_label} must be at least 1.")
    return value


def validate_and_calculate(payload):
    errors = []

    if not isinstance(payload, dict):
        raise ValidationError(["Malformed request body."])

    raw_products = payload.get("products")
    raw_people = payload.get("people")
    raw_extra = payload.get("extra_charge")

    if not isinstance(raw_products, list) or len(raw_products) == 0:
        errors.append("Add at least one product.")
        raw_products = []

    if not isinstance(raw_people, list) or len(raw_people) == 0:
        errors.append("Add at least one person.")
        raw_people = []

    # ---- Parse products ----
    products = {}  # id -> {name, price, quantity, allocated}
    seen_names = {}
    for idx, p in enumerate(raw_products, start=1):
        label = f"Product #{idx}"
        if not isinstance(p, dict):
            errors.append(f"{label} is malformed.")
            continue

        pid = p.get("id")
        if not pid or not isinstance(pid, str):
            errors.append(f"{label} is missing an internal id.")
            continue

        name = (p.get("name") or "").strip()
        if not name:
            name = f"p{idx}"
        label = f'Product "{name}"'

        name_key = name.lower()
        if name_key in seen_names:
            errors.append(f'Duplicate product name "{name}" — product names must be unique.')
            continue
        seen_names[name_key] = pid

        try:
            price = parse_positive_decimal(p.get("price"), f"{label} price")
        except ValueError as e:
            errors.append(str(e))
            continue

        try:
            quantity = parse_positive_int(p.get("quantity", 1), f"{label} quantity")
        except ValueError as e:
            errors.append(str(e))
            continue

        if pid in products:
            errors.append(f"{label} has a duplicate internal id.")
            continue

        products[pid] = {
            "id": pid,
            "name": name,
            "price": price,
            "quantity": quantity,
            "allocated": 0,
        }

    # ---- Parse people & their purchases ----
    people = []
    seen_person_names = {}
    for idx, person in enumerate(raw_people, start=1):
        label = f"Person #{idx}"
        if not isinstance(person, dict):
            errors.append(f"{label} is malformed.")
            continue

        pname = (person.get("name") or "").strip()
        if not pname:
            pname = f"Person {idx}"
        label = f'"{pname}"'

        pname_key = pname.lower()
        if pname_key in seen_person_names:
            errors.append(f'Duplicate person name "{pname}" — names must be unique.')
            continue
        seen_person_names[pname_key] = True

        raw_purchases = person.get("purchases")
        if not isinstance(raw_purchases, list) or len(raw_purchases) == 0:
            errors.append(f"{label} has no products assigned. Every person must buy something.")
            continue

        parsed_purchases = []
        for pu_idx, purchase in enumerate(raw_purchases, start=1):
            if not isinstance(purchase, dict):
                errors.append(f"{label} has a malformed purchase entry.")
                continue

            product_id = purchase.get("product_id")
            if not product_id or product_id not in products:
                errors.append(f'{label} selected a product that no longer exists (row {pu_idx}).')
                continue

            try:
                qty = parse_positive_int(purchase.get("quantity", 1), f"{label}'s purchase quantity")
            except ValueError as e:
                errors.append(str(e))
                continue

            parsed_purchases.append({"product_id": product_id, "quantity": qty})
            products[product_id]["allocated"] += qty

        if parsed_purchases:
            people.append({"name": pname, "purchases": parsed_purchases})

    # ---- Cross-check allocation: every unit of every product must be
    #      claimed by exactly the people who bought it, no more, no less ----
    for prod in products.values():
        if prod["allocated"] != prod["quantity"]:
            if prod["allocated"] < prod["quantity"]:
                missing = prod["quantity"] - prod["allocated"]
                errors.append(
                    f'"{prod["name"]}": {missing} unit(s) out of {prod["quantity"]} were not '
                    f"assigned to anyone. Every purchased unit must belong to a person."
                )
            else:
                extra = prod["allocated"] - prod["quantity"]
                errors.append(
                    f'"{prod["name"]}": {extra} more unit(s) were assigned to people than were '
                    f'actually bought (only {prod["quantity"]} available).'
                )

    # ---- Extra charge ----
    try:
        extra_charge = parse_positive_decimal(raw_extra, "Extra charge", allow_zero=True)
    except ValueError as e:
        errors.append(str(e))
        extra_charge = None

    if errors:
        raise ValidationError(errors)

    # ---- Calculate ----
    total_base = sum((prod["price"] * prod["quantity"] for prod in products.values()), Decimal("0"))

    if total_base <= 0:
        raise ValidationError(["Total bill amount must be greater than 0."])

    extra_percentage = (extra_charge / total_base) * Decimal("100")

    breakdown = []
    running_total = Decimal("0")
    for person in people:
        base_spend = Decimal("0")
        items = []
        for purchase in person["purchases"]:
            prod = products[purchase["product_id"]]
            line_total = prod["price"] * purchase["quantity"]
            base_spend += line_total
            items.append({
                "product_name": prod["name"],
                "unit_price": float(to_money(prod["price"])),
                "quantity": purchase["quantity"],
                "line_total": float(to_money(line_total)),
            })

        extra_share = base_spend * extra_charge / total_base if total_base > 0 else Decimal("0")
        person_total = base_spend + extra_share
        person_pct = (extra_share / base_spend * Decimal("100")) if base_spend > 0 else Decimal("0")

        running_total += to_money(person_total)
        breakdown.append({
            "name": person["name"],
            "items": items,
            "base_spend": float(to_money(base_spend)),
            "extra_share": float(to_money(extra_share)),
            "total": float(to_money(person_total)),
            "percentage_increase": float(to_money(person_pct)),
        })

    # Reconcile rounding: nudge the largest payer so totals foot exactly.
    grand_total_target = to_money(total_base + extra_charge)
    rounding_diff = grand_total_target - running_total
    if rounding_diff != 0 and breakdown:
        largest = max(breakdown, key=lambda b: b["total"])
        largest["total"] = float(to_money(Decimal(str(largest["total"])) + rounding_diff))

    return {
        "total_base": float(to_money(total_base)),
        "extra_charge": float(to_money(extra_charge)),
        "grand_total": float(grand_total_target),
        "extra_percentage": float(to_money(extra_percentage)),
        "breakdown": breakdown,
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/calculate", methods=["POST"])
def calculate():
    payload = request.get_json(silent=True)
    if payload is None:
        return jsonify({"errors": ["Request body must be valid JSON."]}), 400

    try:
        result = validate_and_calculate(payload)
    except ValidationError as e:
        return jsonify({"errors": e.errors}), 400
    except Exception:
        return jsonify({"errors": ["Something went wrong while calculating the split. Please check your inputs."]}), 500

    return jsonify(result), 200


if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(debug=debug, host="0.0.0.0", port=port)
