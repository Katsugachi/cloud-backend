const express = require("express");
const { randomUUID } = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

async function loginWithGoogle(idToken) {
  const deviceId  = randomUUID();
  const queryUuid = randomUUID();
  const loginUrl  = new URL("https://api.prod.cloudmoonapp.com/login/google");
  loginUrl.searchParams.set("device_type", "web");
  loginUrl.searchParams.set("query_uuid",  queryUuid);
  loginUrl.searchParams.set("device_id",   deviceId);
  loginUrl.searchParams.set("site",        "cm");
  const r    = await fetch(loginUrl.toString(), {
    method:  "POST",
    headers: { "Content-Type": "application/json", "X-User-Language": "en", "X-User-Locale": "US" },
    body:    JSON.stringify({ google_id_token: idToken })
  });
  const json = await r.json();
  console.log("CloudMoon login:", JSON.stringify(json));
  if (json.code !== 0) throw new Error(JSON.stringify(json));

  const token   = json.data.token;
  const user_id = json.data.user_id;
  const headers = { "X-User-Token": token, "X-User-Language": "en", "X-User-Locale": "US" };

  const plUrl = new URL("https://api.prod.cloudmoonapp.com/phone/list");
  plUrl.searchParams.set("device_type", "web");
  plUrl.searchParams.set("query_uuid",  randomUUID());
  plUrl.searchParams.set("device_id",   deviceId);
  plUrl.searchParams.set("site",        "cm");
  const phoneList = await (await fetch(plUrl.toString(), { headers })).json();

  return {
    token,
    user_id,
    android_id: phoneList?.data?.list?.[0]?.android_id || "1951154706843701248"
  };
}

app.get("/auth/exchange", async (req, res) => {
  const { id_token } = req.query;
  if (!id_token) return res.status(400).json({ error: "Missing id_token" });
  try {
    const session = await loginWithGoogle(id_token);
    res.json(session);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Running on port ${PORT}`));
