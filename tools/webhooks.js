"use strict";

const { createWebhookDelivery } = require("../lib/webhook-delivery.js");

async function main() {
  const delivery = createWebhookDelivery({});
  const action = process.argv[2];
  if (action === "log") return { entries: delivery.log() };
  if (action === "test") return { entry: await delivery.test() };
  throw new Error("Unknown webhook action.");
}

main().then((result) => {
  process.stdout.write(JSON.stringify(result) + "\n");
}, (error) => {
  process.stdout.write(JSON.stringify({ error: error.message }) + "\n");
  process.exitCode = 1;
});
