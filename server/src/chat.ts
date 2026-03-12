/**
 * Boscopan — Interactive Chat Interface
 *
 * This module provides an interactive terminal interface for chatting with
 * Boscopan. Users can type messages directly instead of using curl.
 * 
 * The chat interface makes HTTP requests to the server's /chat endpoint
 * and displays responses in a user-friendly format.
 */

import { createInterface } from "readline";

/**
 * Starts an interactive chat interface in the terminal
 * 
 * This allows users to chat directly with the server without using curl.
 * The interface connects to the server's /chat endpoint and displays
 * responses including alert details and CRE workflow payloads.
 * 
 * @param port - The port number the server is running on (default: 3000)
 */
export function startChatInterface(port: number = 3000): void {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> "
  });

  const SERVER_URL = `http://localhost:${port}`;

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Interactive Chat Enabled");
  console.log("Type your message and press Enter (type 'exit' or 'quit' to leave)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  rl.prompt();

  rl.on("line", async (input) => {
    const message = input.trim();

    // Handle exit commands
    if (message === "exit" || message === "quit" || message === "q") {
      console.log("\nChat disabled. Server continues running.\n");
      rl.close();
      return;
    }

    // Skip empty messages
    if (!message) {
      rl.prompt();
      return;
    }

    // Send message to /chat endpoint
    try {
      const response = await fetch(`${SERVER_URL}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ message })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }));
        console.log(`\n[ERROR] ${error.error || response.statusText}\n`);
        rl.prompt();
        return;
      }

      const data = await response.json();

      // Display reply
      if (data.reply) {
        console.log(`\n${data.reply}\n`);
      }

      // Display alert(s) created (single or multi-step)
      const alerts = data.alerts ?? (data.alert ? [data.alert] : []);
      if (alerts.length) {
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log(alerts.length === 1 ? "Alert Created:" : "Alerts Created:");
        for (let i = 0; i < alerts.length; i++) {
          const a = alerts[i];
          console.log(`  ${i + 1}. ${a.asset} ${a.condition} $${(a.targetPriceUsd ?? 0).toLocaleString()} (ID: ${a.id})`);
        }
        if (data.transactionHash) console.log(`  Transaction: ${data.transactionHash}`);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        if (alerts.length) {
          console.log("\nCRE Workflow Payload(s) (copy for HTTP trigger):\n");
          for (let i = 0; i < alerts.length; i++) {
            const a = alerts[i];
            const payload = { id: a.id, asset: a.asset, condition: a.condition, targetPriceUsd: a.targetPriceUsd, createdAt: a.createdAt };
            if (alerts.length > 1) console.log(`  Alert ${i + 1}:`);
            console.log(JSON.stringify(payload));
            if (i < alerts.length - 1) console.log("");
          }
          console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        }
      }

      if (data.listedAlerts && data.listedAlerts.length > 0) {
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log("Your alerts (from registry):");
        data.listedAlerts.forEach((a: { asset: string; condition: string; targetPriceUsd: number }, i: number) => {
          console.log(`  ${i + 1}. ${a.asset} ${a.condition} $${a.targetPriceUsd.toLocaleString()}`);
        });
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
      }

      if (data.currentPrices && Object.keys(data.currentPrices).length > 0) {
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log("Current prices (USD):");
        Object.entries(data.currentPrices).forEach(([asset, price]) => {
          console.log(`  ${asset}: $${Number(price).toLocaleString()}`);
        });
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
      }

      if (data.cancelled && data.cancelled.length > 0) {
        console.log(`Cancelled: ${data.cancelled.join(", ")}\n`);
      }
      if (data.errors && data.errors.length > 0) {
        console.log(`[WARN] ${data.errors.join("; ")}\n`);
      }
    } catch (error: any) {
      console.log(`\n[ERROR] ${error.message}\n`);
    }

    rl.prompt();
  });

  rl.on("close", () => {
    console.log("\nChat disabled. Server continues running.\n");
  });
}

