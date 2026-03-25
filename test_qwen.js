// test_qwen.js
const token = "f51b2ec5bc6adb994604aef3574a7aa1097c73ed288fef2a07ad7330e569174b";

async function testQwen() {
  console.log("Sending prompt to Qwen CLI via Local Daemon...");
  try {
    const response = await fetch("http://127.0.0.1:5059/qwen", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Local-Token": token
      },
      body: JSON.stringify({
        prompt: "Say hello world and nothing else."
      })
    });
    
    if (response.ok) {
      console.log("\n✅ Success! Local Daemon relayed the request to the Qwen CLI.");
      const data = await response.text();
      console.log("--------------- QWEN RESPONSE ---------------");
      console.log(data);
      console.log("------------------------------------------");
    } else {
      console.error("❌ Failed. HTTP Status:", response.status);
      const text = await response.text();
      console.error(text);
    }
  } catch (err) {
    console.error("❌ Error executing request:", err.message);
  }
}

testQwen();
