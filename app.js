/**
 * Ledger — frontend
 * Manages products & people as in-memory state, renders them into the
 * two ledger columns, keeps purchase dropdowns in sync with the product
 * list, and posts to /api/calculate for the authoritative split.
 */

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);

class Product {
  constructor({ id = uid(), name = "", price = "", quantity = 1 } = {}) {
    this.id = id;
    this.name = name;
    this.price = price;
    this.quantity = quantity;
  }
}

class Purchase {
  constructor({ id = uid(), productId = "", quantity = 1 } = {}) {
    this.id = id;
    this.productId = productId;
    this.quantity = quantity;
  }
}

class Person {
  constructor({ id = uid(), name = "", purchases = [] } = {}) {
    this.id = id;
    this.name = name;
    this.purchases = purchases;
  }
}

class LedgerApp {
  constructor() {
    this.products = [];
    this.people = [];

    // DOM references
    this.productRowsEl = document.getElementById("product-rows");
    this.personCardsEl = document.getElementById("person-cards");
    this.addProductBtn = document.getElementById("add-product-btn");
    this.addPersonBtn = document.getElementById("add-person-btn");
    this.calculateBtn = document.getElementById("calculate-btn");
    this.extraChargeInput = document.getElementById("extra-charge-input");
    this.globalErrorsPanel = document.getElementById("global-errors");
    this.globalErrorsList = document.getElementById("global-errors-list");
    this.resultSection = document.getElementById("result-section");
    this.receiptEl = document.getElementById("receipt");

    this.productRowTpl = document.getElementById("product-row-template");
    this.personCardTpl = document.getElementById("person-card-template");
    this.purchaseRowTpl = document.getElementById("purchase-row-template");

    this._bindGlobalEvents();

    // Start with a friendly default: two products, one person, so the
    // ledger doesn't open on an intimidating blank page.
    this.addProduct();
    this.addProduct();
    this.addPerson();
  }

  _bindGlobalEvents() {
    this.addProductBtn.addEventListener("click", () => this.addProduct());
    this.addPersonBtn.addEventListener("click", () => this.addPerson());
    this.calculateBtn.addEventListener("click", () => this.calculate());
  }

  /* ---------------------------------------------------------------- */
  /* Products                                                          */
  /* ---------------------------------------------------------------- */

  addProduct() {
    const product = new Product({ quantity: 1 });
    this.products.push(product);
    this.renderProducts();
    this.refreshAllPurchaseSelects();
  }

  removeProduct(id) {
    this.products = this.products.filter((p) => p.id !== id);
    // Any purchase referencing this product is no longer valid — drop it.
    this.people.forEach((person) => {
      person.purchases = person.purchases.filter((pu) => pu.productId !== id);
    });
    this.renderProducts();
    this.renderPeople();
  }

  renderProducts() {
    this.productRowsEl.innerHTML = "";
    this.products.forEach((product, index) => {
      const node = this.productRowTpl.content.firstElementChild.cloneNode(true);
      node.dataset.id = product.id;
      node.querySelector('[data-role="row-num"]').textContent = `${index + 1}.`;

      const nameInput = node.querySelector('[data-role="name"]');
      nameInput.value = product.name;
      nameInput.placeholder = `p${index + 1}`;
      nameInput.addEventListener("input", (e) => {
        product.name = e.target.value;
        this.refreshAllPurchaseSelects();
      });

      const priceInput = node.querySelector('[data-role="price"]');
      priceInput.value = product.price;
      priceInput.addEventListener("input", (e) => {
        product.price = e.target.value;
      });

      const qtyInput = node.querySelector('[data-role="quantity"]');
      qtyInput.value = product.quantity;
      qtyInput.addEventListener("input", (e) => {
        product.quantity = e.target.value;
        this.refreshAllPurchaseSelects();
      });

      node.querySelector('[data-role="remove"]').addEventListener("click", () => {
        this.removeProduct(product.id);
      });

      this.productRowsEl.appendChild(node);
    });
  }

  /** Display name to show in dropdowns / receipts for a product, falling
   *  back to the generic p1/p2/... form if the user left it blank. */
  displayNameFor(product, index) {
    const trimmed = (product.name || "").trim();
    return trimmed || `p${index + 1}`;
  }

  /** How many units of a product have been assigned to people so far. */
  allocatedQuantity(productId) {
    let total = 0;
    this.people.forEach((person) => {
      person.purchases.forEach((pu) => {
        if (pu.productId === productId) total += Number(pu.quantity) || 0;
      });
    });
    return total;
  }

  /* ---------------------------------------------------------------- */
  /* People                                                             */
  /* ---------------------------------------------------------------- */

  addPerson() {
    const person = new Person();
    this.people.push(person);
    if (this.products.length > 0) {
      person.purchases.push(new Purchase({ productId: this.products[0].id, quantity: 1 }));
    }
    this.renderPeople();
  }

  removePerson(id) {
    this.people = this.people.filter((p) => p.id !== id);
    this.renderPeople();
  }

  addPurchaseToPerson(personId) {
    const person = this.people.find((p) => p.id === personId);
    if (!person || this.products.length === 0) return;
    person.purchases.push(new Purchase({ productId: this.products[0].id, quantity: 1 }));
    this.renderPeople();
  }

  removePurchaseFromPerson(personId, purchaseId) {
    const person = this.people.find((p) => p.id === personId);
    if (!person) return;
    person.purchases = person.purchases.filter((pu) => pu.id !== purchaseId);
    this.renderPeople();
  }

  renderPeople() {
    this.personCardsEl.innerHTML = "";
    this.people.forEach((person, index) => {
      const node = this.personCardTpl.content.firstElementChild.cloneNode(true);
      node.dataset.id = person.id;
      node.querySelector('[data-role="row-num"]').textContent = `${index + 1}.`;

      const nameInput = node.querySelector('[data-role="name"]');
      nameInput.value = person.name;
      nameInput.placeholder = `Person ${index + 1}`;
      nameInput.addEventListener("input", (e) => {
        person.name = e.target.value;
      });

      node.querySelector('[data-role="remove-person"]').addEventListener("click", () => {
        this.removePerson(person.id);
      });

      const purchasesEl = node.querySelector('[data-role="purchases"]');
      const addPurchaseBtn = node.querySelector('[data-role="add-purchase"]');

      if (this.products.length === 0) {
        addPurchaseBtn.disabled = true;
        const msg = document.createElement("p");
        msg.className = "no-products-msg";
        msg.textContent = "Add a product first.";
        purchasesEl.appendChild(msg);
      } else {
        addPurchaseBtn.disabled = false;
        person.purchases.forEach((purchase) => {
          purchasesEl.appendChild(this.buildPurchaseRow(person, purchase));
        });
      }

      addPurchaseBtn.addEventListener("click", () => this.addPurchaseToPerson(person.id));

      this.personCardsEl.appendChild(node);
    });
  }

  buildPurchaseRow(person, purchase) {
    const node = this.purchaseRowTpl.content.firstElementChild.cloneNode(true);
    node.dataset.id = purchase.id;

    const select = node.querySelector('[data-role="product-select"]');
    this.populateProductSelect(select, purchase.productId);
    select.addEventListener("change", (e) => {
      purchase.productId = e.target.value;
    });

    const qtyInput = node.querySelector('[data-role="quantity"]');
    qtyInput.value = purchase.quantity;
    qtyInput.addEventListener("input", (e) => {
      purchase.quantity = e.target.value;
    });

    node.querySelector('[data-role="remove-purchase"]').addEventListener("click", () => {
      this.removePurchaseFromPerson(person.id, purchase.id);
    });

    return node;
  }

  populateProductSelect(selectEl, selectedId) {
    selectEl.innerHTML = "";
    this.products.forEach((product, index) => {
      const opt = document.createElement("option");
      opt.value = product.id;
      opt.textContent = this.displayNameFor(product, index);
      selectEl.appendChild(opt);
    });
    if (selectedId && this.products.some((p) => p.id === selectedId)) {
      selectEl.value = selectedId;
    } else if (this.products.length > 0) {
      selectEl.value = this.products[0].id;
    }
  }

  /** Re-render every purchase row's <select> so names/availability stay
   *  in sync after a product is renamed, added, or removed — without
   *  losing what's currently selected. */
  refreshAllPurchaseSelects() {
    const selects = this.personCardsEl.querySelectorAll('[data-role="product-select"]');
    selects.forEach((selectEl) => {
      const currentValue = selectEl.value;
      this.populateProductSelect(selectEl, currentValue);
    });
  }

  /* ---------------------------------------------------------------- */
  /* Validation (client-side, fast feedback) + payload building        */
  /* ---------------------------------------------------------------- */

  buildPayload() {
    const products = this.products.map((p, index) => ({
      id: p.id,
      name: (p.name || "").trim() || `p${index + 1}`,
      price: p.price,
      quantity: p.quantity,
    }));

    const people = this.people.map((person, index) => ({
      name: (person.name || "").trim() || `Person ${index + 1}`,
      purchases: person.purchases.map((pu) => ({
        product_id: pu.productId,
        quantity: pu.quantity,
      })),
    }));

    return {
      products,
      people,
      extra_charge: this.extraChargeInput.value,
    };
  }

  /** Quick client-side sanity checks so we don't even hit the network
   *  for obviously incomplete forms. The backend re-validates everything
   *  regardless — this is purely for a faster feedback loop. */
  quickClientErrors() {
    const errors = [];
    if (this.products.length === 0) errors.push("Add at least one product.");
    if (this.people.length === 0) errors.push("Add at least one person.");

    this.products.forEach((p, i) => {
      const label = (p.name || "").trim() || `p${i + 1}`;
      if (p.price === "" || p.price === null || Number(p.price) <= 0 || Number.isNaN(Number(p.price))) {
        errors.push(`"${label}": enter a price greater than 0.`);
      }
      if (!Number.isInteger(Number(p.quantity)) || Number(p.quantity) < 1) {
        errors.push(`"${label}": quantity must be a whole number of at least 1.`);
      }
    });

    this.people.forEach((person, i) => {
      const label = (person.name || "").trim() || `Person ${i + 1}`;
      if (person.purchases.length === 0) {
        errors.push(`"${label}" has no products assigned.`);
      }
      person.purchases.forEach((pu) => {
        if (!Number.isInteger(Number(pu.quantity)) || Number(pu.quantity) < 1) {
          errors.push(`"${label}": purchase quantity must be a whole number of at least 1.`);
        }
      });
    });

    const extra = this.extraChargeInput.value;
    if (extra === "" || Number.isNaN(Number(extra)) || Number(extra) < 0) {
      errors.push("Extra charge must be 0 or a positive number.");
    }

    return errors;
  }

  /* ---------------------------------------------------------------- */
  /* Calculate                                                          */
  /* ---------------------------------------------------------------- */

  async calculate() {
    this.hideErrors();
    this.hideResult();

    const clientErrors = this.quickClientErrors();
    if (clientErrors.length > 0) {
      this.showErrors(clientErrors);
      return;
    }

    const payload = this.buildPayload();

    this.calculateBtn.disabled = true;
    this.calculateBtn.textContent = "Totting up…";

    try {
      const response = await fetch("/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error("The server sent back something Ledger couldn't read.");
      }

      if (!response.ok) {
        this.showErrors(data.errors || ["The split couldn't be calculated. Please check your entries."]);
        return;
      }

      this.renderReceipt(data);
    } catch (err) {
      this.showErrors([
        err instanceof TypeError
          ? "Couldn't reach the server. Check your connection and try again."
          : (err.message || "Something unexpected happened. Please try again."),
      ]);
    } finally {
      this.calculateBtn.disabled = false;
      this.calculateBtn.textContent = "Split the bill";
    }
  }

  /* ---------------------------------------------------------------- */
  /* Rendering: errors + result                                        */
  /* ---------------------------------------------------------------- */

  showErrors(errors) {
    this.globalErrorsList.innerHTML = "";
    errors.forEach((msg) => {
      const li = document.createElement("li");
      li.textContent = msg;
      this.globalErrorsList.appendChild(li);
    });
    this.globalErrorsPanel.hidden = false;
    this.globalErrorsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  hideErrors() {
    this.globalErrorsPanel.hidden = true;
    this.globalErrorsList.innerHTML = "";
  }

  hideResult() {
    this.resultSection.hidden = true;
    this.receiptEl.innerHTML = "";
  }

  formatMoney(value) {
    return `₹${Number(value).toFixed(2)}`;
  }

  renderReceipt(data) {
    const { total_base, extra_charge, grand_total, extra_percentage, breakdown } = data;

    const el = this.receiptEl;
    el.innerHTML = "";

    const title = document.createElement("h2");
    title.className = "receipt__title";
    title.textContent = "Split Receipt";
    el.appendChild(title);

    const stamp = document.createElement("span");
    stamp.className = "receipt__stamp";
    stamp.textContent = `+${extra_percentage.toFixed(2)}% applied across the board`;
    el.appendChild(stamp);

    el.appendChild(document.createElement("hr"));

    breakdown.forEach((person) => {
      const block = document.createElement("div");
      block.className = "receipt-person";

      const name = document.createElement("div");
      name.className = "receipt-person__name";
      name.textContent = person.name;
      block.appendChild(name);

      person.items.forEach((item) => {
        const line = document.createElement("div");
        line.className = "receipt-line";
        line.innerHTML = `
          <span class="receipt-line__label">${item.quantity} × ${this.escapeHtml(item.product_name)}</span>
          <span class="receipt-line__leader"></span>
          <span class="receipt-line__value">${this.formatMoney(item.line_total)}</span>
        `;
        block.appendChild(line);
      });

      const sub = document.createElement("div");
      sub.className = "receipt-person__sub";
      sub.innerHTML = `
        <span>base ${this.formatMoney(person.base_spend)} &nbsp;+&nbsp; extra ${this.formatMoney(person.extra_share)}</span>
      `;
      block.appendChild(sub);

      const totalRow = document.createElement("div");
      totalRow.className = "receipt-person__sub";
      totalRow.innerHTML = `
        <span class="receipt-person__total">Pays ${this.formatMoney(person.total)}</span>
        <span class="receipt-person__pct">+${person.percentage_increase.toFixed(2)}%</span>
      `;
      block.appendChild(totalRow);

      el.appendChild(block);
    });

    el.appendChild(document.createElement("hr"));

    const baseRow = document.createElement("div");
    baseRow.className = "receipt-line";
    baseRow.innerHTML = `<span class="receipt-line__label">Item total</span><span class="receipt-line__leader"></span><span class="receipt-line__value">${this.formatMoney(total_base)}</span>`;
    el.appendChild(baseRow);

    const extraRow = document.createElement("div");
    extraRow.className = "receipt-line";
    extraRow.innerHTML = `<span class="receipt-line__label">Extra charge</span><span class="receipt-line__leader"></span><span class="receipt-line__value">${this.formatMoney(extra_charge)}</span>`;
    el.appendChild(extraRow);

    const grandRow = document.createElement("div");
    grandRow.className = "receipt__grand";
    grandRow.innerHTML = `<span>Grand total</span><span>${this.formatMoney(grand_total)}</span>`;
    el.appendChild(grandRow);

    const meta = document.createElement("p");
    meta.className = "receipt__meta";
    meta.textContent = "Split proportionally by what each person actually bought.";
    el.appendChild(meta);

    this.resultSection.hidden = false;
    this.resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new LedgerApp();
});
