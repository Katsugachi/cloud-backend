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

// CloudMoon's own Google client ID
const CM_CLIENT_ID     = "196443591263-k5447s9icscrq54n57j29lmvm05addbe.apps.googleusercontent.com";
const CM_CLIENT_SECRET = ""; // Not needed for this flow
const BACKEND_URL      = process.env.BACKEND_URL || "https://cloud-backend-63gq.onrender.com";

// ── Step 1: Redirect to Google OAuth ────────────────────
// Uses CloudMoon's client_id so the returned id_token has aud = CloudMoon
app.get("/auth/google", (req, res) => {
  const state    = randomUUID();
  const authUrl  = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id",     CM_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri",  BACKEND_URL + "/auth/callback");
  authUrl.searchParams.set("response_type", "id_token token");
  authUrl.searchParams.set("scope",         "openid email profile");
  authUrl.searchParams.set("nonce",         randomUUID());
  authUrl.searchParams.set("state",         state);
  res.redirect(authUrl.toString());
});

// ── Step 2: Google redirects back here with id_token ────
// id_token will have aud = CloudMoon's client_id ✓
app.get("/auth/callback", (req, res) => {
  // Token comes in the URL fragment (#), so we need JS to extract it
  res.send(`<!DOCTYPE html>
<html>
<head><title>Signing in...</title></head>
<body style="font-family:sans-serif;background:#1e283a;color:#e0e6ed;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
  <div style="text-align:center">
    <div style="font-size:1.2rem;margin-bottom:10px">Connecting to CloudMoon...</div>
    <div id="status">Please wait...</div>
  </div>
  <script>
    // Google returns token in URL fragment
    const params = new URLSearchParams(window.location.hash.slice(1));
    const idToken = params.get('id_token');

    if (!idToken) {
      document.getElementById('status').textContent = 'Error: No token received.';
    } else {
      fetch('/auth/exchange?id_token=' + encodeURIComponent(idToken))
        .then(r => r.json())
        .then(data => {
          if (data.error) {
            document.getElementById('status').textContent = 'Error: ' + data.error;
          } else {
            document.getElementById('status').textContent = 'Connected! Closing...';
            // postMessage back to the opener (Solus MS)
            if (window.opener) {
              window.opener.postMessage({ type: 'CLOUDMOON_AUTH', session: data }, '*');
            }
            setTimeout(() => window.close(), 500);
          }
        })
        .catch(e => {
          document.getElementById('status').textContent = 'Error: ' + e.message;
        });
    }
  </script>
</body>
</html>`);
});

// ── Step 3: Exchange id_token with CloudMoon ─────────────
app.get("/auth/exchange", async (req, res) => {
  const idToken = req.query.id_token;
  if (!idToken) return res.status(400).json({ error: "Missing id_token" });

  try {
    const deviceId  = randomUUID();
    const queryUuid = randomUUID();

    const loginUrl = new URL("https://api.prod.geometry.today/login/google");
    loginUrl.searchParams.set("device_type", "web");
    loginUrl.searchParams.set("query_uuid",  queryUuid);
    loginUrl.searchParams.set("device_id",   deviceId);
    loginUrl.searchParams.set("site",        "cm");

    const loginRes  = await fetch(loginUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User-Language": "en", "X-User-Locale": "US" },
      body: JSON.stringify({ google_id_token: idToken })
    });
    const loginJson = await loginRes.json();
    console.log("CloudMoon login:", JSON.stringify(loginJson));

    if (loginJson.code !== 0) throw new Error(JSON.stringify(loginJson));

    const token    = loginJson.data.token;
    const user_id  = loginJson.data.user_id;
    const headers  = { "X-User-Token": token, "X-User-Language": "en", "X-User-Locale": "US" };

    const phoneListUrl = new URL("https://api.prod.geometry.today/phone/list");
    phoneListUrl.searchParams.set("device_type", "web");
    phoneListUrl.searchParams.set("query_uuid",  randomUUID());
    phoneListUrl.searchParams.set("device_id",   deviceId);
    phoneListUrl.searchParams.set("site",        "cm");
    const phoneList = await (await fetch(phoneListUrl.toString(), { headers })).json();

    res.json({
      token,
      user_id,
      android_id: phoneList?.data?.list?.[0]?.android_id || "1951154706843701248"
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── Original /user-info for email login ──────────────────
async function loginWithEmail(email, password) {
  const deviceId  = randomUUID();
  const queryUuid = randomUUID();
  const loginUrl  = new URL("https://api.prod.geometry.today/login/pwd");
  loginUrl.searchParams.set("device_type", "web");
  loginUrl.searchParams.set("query_uuid",  queryUuid);
  loginUrl.searchParams.set("device_id",   deviceId);
  loginUrl.searchParams.set("site",        "cm");
  const response = await fetch(loginUrl.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Language": "en", "X-User-Locale": "US" },
    body: JSON.stringify({ email, password })
  });
  const json = await response.json();
  if (!response.ok || json.code !== 0) throw new Error(`Email login failed: ${JSON.stringify(json)}`);
  return { token: json.data.token, user_id: json.data.user_id, deviceId };
}

app.get("/user-info", async (req, res) => {
  const { email, password } = req.query;
  if (!email || !password) return res.status(400).json({ error: "Missing credentials" });
  try {
    const { token, user_id, deviceId } = await loginWithEmail(email, password);
    const headers = { "X-User-Token": token, "X-User-Language": "en", "X-User-Locale": "US" };

    const phoneListUrl = new URL("https://api.prod.geometry.today/phone/list");
    phoneListUrl.searchParams.set("device_type", "web");
    phoneListUrl.searchParams.set("query_uuid",  randomUUID());
    phoneListUrl.searchParams.set("device_id",   deviceId);
    phoneListUrl.searchParams.set("site",        "cm");
    const phoneList = await (await fetch(phoneListUrl.toString(), { headers })).json();

    res.json({ user_id, token, android_id: phoneList?.data?.list?.[0]?.android_id || "1951154706843701248" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Running on port ${PORT}`));
