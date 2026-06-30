const url = "http://127.0.0.1:3000/api/health";
const maxAttempts = 60;

for (let i = 0; i < maxAttempts; i++) {
  try {
    const res = await fetch(url);
    if (res.ok) process.exit(0);
  } catch {
    // server not ready yet
  }
  await new Promise((r) => setTimeout(r, 250));
}

console.error("Timed out waiting for game server on http://127.0.0.1:3000");
process.exit(1);
