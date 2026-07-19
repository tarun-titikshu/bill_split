# Ledger — split the bill fairly

A small web app that splits a bill proportionally by what each person
actually spent, instead of splitting extra charges (tax, delivery, fees)
equally by headcount.

## Run it

```bash
pip install -r requirements.txt
python app.py
```

Then open **http://localhost:5000**

## How it works

1. **Products** — add each item with a price and quantity (defaults to 1).
   Leave the name blank and it becomes `p1`, `p2`, `p3`…
2. **People** — add each person and assign the exact products (and
   quantities) they bought. Every unit of every product must be assigned
   to someone — the app will tell you if something's left over or
   double-assigned.
3. **Extra charge** — enter tax/delivery/fees/surcharge on top of the item
   total (0 if none).
4. Click **Split the bill** — Ledger works out each person's share of the
   extra charge in proportion to their base spend, and shows a receipt
   with each person's total and their individual percentage increase.

## Project structure

```
app.py                  Flask backend: validation + split calculation
templates/index.html    Page markup (two-column ledger + receipt)
static/css/style.css    Styling
static/js/app.js        ES6 frontend logic (state, rendering, API calls)
requirements.txt        Python dependencies
```

## Validation covered

- Missing/empty products or people
- Non-numeric or non-positive prices
- Non-integer or non-positive quantities
- Duplicate product names or person names (case-insensitive)
- Purchases referencing a deleted/unknown product
- Under- or over-allocated product quantities (every unit bought must be
  assigned to exactly one person, no more, no less)
- Negative or non-numeric extra charge
- Malformed/non-JSON request bodies (backend)
- Network failures and unexpected server errors (frontend)

Rounding is handled with `Decimal` (not floats) and any last-cent rounding
gap is reconciled onto the largest payer so the totals always foot exactly
against the grand total.
