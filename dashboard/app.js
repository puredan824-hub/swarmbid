/* Copy data.sample.json to data.json and serve this directory with any static
 * HTTP server. Open index.html through HTTP; file:// fetch is restricted.
 * Amounts are rounded half up to four decimals using integer arithmetic only.
 */
"use strict";

(() => {
  const states = new Set([
    "Open", "Bidding", "Negotiating", "Awarded", "Funded", "Delivered",
    "Accepted", "Released", "Refunded", "Cancelled"
  ]);

  function near(value) {
    if (typeof value !== "string" || !/^\d+$/.test(value)) return "Unavailable";
    const units = (BigInt(value) + 5n * 10n ** 19n) / (10n ** 20n);
    return `${units / 10000n}.${String(units % 10000n).padStart(4, "0")} NEAR`;
  }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }

  function badge(state) {
    return element("span", state || "Unknown", `badge state-${states.has(state) ? state.toLowerCase() : "unknown"}`);
  }

  function field(list, label, value) {
    list.append(element("dt", label), element("dd", value ?? "Unavailable"));
  }

  function transaction(label, hash) {
    const link = element("a", label);
    link.href = `https://testnet.nearblocks.io/txns/${encodeURIComponent(hash)}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.title = String(hash);
    return link;
  }

  function renderTask(task, receipts) {
    const card = element("article", null, "card task");
    const heading = element("div", null, "card-heading");
    heading.append(element("h3", task.title || task.id || "Untitled task"), badge(task.state));
    const info = element("dl");
    // The work-order bids have no id field. A terminal receipt supplies the
    // settled winning price without inventing a chosenBidId mapping.
    const receipt = receipts.find(item => item.taskId === task.id &&
      (item.result === "Released" || item.result === "Refunded"));
    field(info, "Task ID", task.id);
    field(info, "Budget", near(task.budgetYocto));
    field(info, "Awarded price (receipt)", receipt ? near(receipt.amountYocto) : "Unavailable");
    if (task.deliverable) {
      field(info, "Deliverable", task.deliverable.path);
      field(info, "SHA-256", task.deliverable.sha256);
    }
    card.append(heading, info);
    if (task.escrowTxHash) card.append(transaction("Escrow transaction", task.escrowTxHash));
    card.append(element("h4", "Bid details"));
    const bids = Array.isArray(task.bids) ? task.bids : [];
    if (!bids.length) {
      card.append(element("p", "No bids.", "empty"));
      return card;
    }
    const scroll = element("div", null, "table-scroll");
    scroll.tabIndex = 0;
    scroll.setAttribute("role", "region");
    scroll.setAttribute("aria-label", `Bids for ${task.title || task.id}`);
    const table = element("table");
    const caption = element("caption", `Bids for ${task.title || task.id}`, "visually-hidden");
    const head = element("thead");
    const labels = element("tr");
    for (const label of ["Worker", "Price", "ETA (minutes)", "Round", "Offer", "Reason"]) {
      const cell = element("th", label);
      cell.scope = "col";
      labels.append(cell);
    }
    head.append(labels);
    const body = element("tbody");
    for (const bid of bids) {
      const row = element("tr");
      for (const value of [bid.workerAccount, near(bid.priceYocto), bid.etaMinutes, bid.round]) {
        row.append(element("td", value ?? "Unavailable"));
      }
      const offer = element("td");
      offer.append(element("span", bid.round > 1 ? "Counteroffer" : "Initial bid",
        bid.round > 1 ? "badge counteroffer" : "offer"));
      row.append(offer, element("td", bid.reason || "Unavailable"));
      body.append(row);
    }
    table.append(caption, head, body);
    scroll.append(table);
    card.append(scroll);
    return card;
  }

  function renderReceipt(receipt) {
    const card = element("article", null, "card");
    const heading = element("div", null, "card-heading");
    heading.append(element("h3", receipt.receiptId || "Receipt"), badge(receipt.result));
    const info = element("dl");
    field(info, "Task ID", receipt.taskId);
    field(info, "Amount", near(receipt.amountYocto));
    field(info, "Buyer", receipt.buyer);
    field(info, "Worker", receipt.worker);
    field(info, "Checks", receipt.checksSummary);
    field(info, "Timestamp", receipt.timestamp);
    card.append(heading, info);
    const links = element("div", null, "transaction-links");
    for (const [name, hash] of Object.entries(receipt.txHashes || {})) {
      if (typeof hash === "string" && hash) links.append(transaction(`${name}: Explorer`, hash));
    }
    card.append(links.childNodes.length ? links : element("p", "No transactions.", "empty"));
    return card;
  }

  function render(data) {
    if (!data || !Array.isArray(data.tasks) || !Array.isArray(data.receipts)) {
      throw new Error("Expected { tasks: [], receipts: [] }.");
    }
    const tasks = document.getElementById("tasks");
    const receipts = document.getElementById("receipts");
    tasks.replaceChildren(...data.tasks.map(task => renderTask(task, data.receipts)));
    receipts.replaceChildren(...data.receipts.map(renderReceipt));
    if (!data.tasks.length) tasks.append(element("p", "No tasks.", "empty"));
    if (!data.receipts.length) receipts.append(element("p", "No receipts.", "empty"));
  }

  async function load() {
    const status = document.getElementById("load-status");
    if (location.protocol === "file:") {
      status.textContent = "Serve this directory with a static HTTP server and open index.html through HTTP. Copy data.sample.json to data.json for sample data.";
      return;
    }
    try {
      const response = await fetch("./data.json", { cache: "no-store" });
      if (response.status === 404) {
        status.textContent = "No data.json. Copy data.sample.json to data.json to view sample data.";
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      render(await response.json());
      status.textContent = "Source: data.json | Amounts: NEAR | Network: testnet";
    } catch (error) {
      status.textContent = `Unable to load data.json. ${error.message}`;
    }
  }

  load();
})();
