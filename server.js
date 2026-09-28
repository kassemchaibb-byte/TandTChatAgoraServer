const express = require("express");
const cors = require("cors");
const {
  RtcTokenBuilder,
  RtcRole
} = require("agora-access-token");

const app = express();

app.use(cors());
app.use(express.json());

const APP_ID = "7bf8bb220f874e7f8f02055ef41330de";

// حط App Certificate تبع Agora هون لاحقاً.
// لا تبعته إلي ولا تحطه داخل APK.
const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE;

app.get("/rtc-token", (req, res) => {
  const channelName = String(req.query.channel || "").trim();
  const uid = Number(req.query.uid || 0);

  if (!channelName) {
    return res.status(400).json({
      error: "channel is required"
    });
  }

  if (!APP_CERTIFICATE) {
    return res.status(500).json({
      error: "AGORA_APP_CERTIFICATE is not configured"
    });
  }

  const userUid = uid > 0 ? uid : 0;

  const expireTimeInSeconds = 3600;
  const privilegeExpireTime =
    Math.floor(Date.now() / 1000) + expireTimeInSeconds;

  const token = RtcTokenBuilder.buildTokenWithUid(
    APP_ID,
    APP_CERTIFICATE,
    channelName,
    userUid,
    RtcRole.PUBLISHER,
    privilegeExpireTime,
    privilegeExpireTime
  );

  res.json({
    appId: APP_ID,
    channel: channelName,
    uid: userUid,
    token: token,
    expiresIn: expireTimeInSeconds
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Agora Token Server running on port ${PORT}`);
});
