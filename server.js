const express = require("express");
const cors = require("cors");
const AgoraAccessToken = require("agora-access-token");
const RtcTokenBuilder = AgoraAccessToken.RtcTokenBuilder;
const RtcRole = AgoraAccessToken.RtcRole;
console.log("DEBUG BUILDER:", RtcTokenBuilder);
console.log("DEBUG BUILD METHOD:", typeof RtcTokenBuilder?.buildTokenWithUid);
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

const app = express();
app.use(cors());
app.use(express.json());

/* =========================
   FIREBASE ADMIN
========================= */

const firebaseServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

if (!firebaseServiceAccount) {
  console.error("ERROR: FIREBASE_SERVICE_ACCOUNT_JSON is not configured.");
  process.exit(1);
}

let serviceAccount;

try {
  serviceAccount = JSON.parse(firebaseServiceAccount);
} catch (error) {
  console.error("ERROR: Invalid FIREBASE_SERVICE_ACCOUNT_JSON:", error.message);
  process.exit(1);
}

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();
const messaging = getMessaging();

console.log("Firebase Admin initialized successfully.");

/* =========================
   AGORA
========================= */

const APP_ID = "7bf8bb220f874e7f8f02055ef41330de";
const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE;

/* =========================
   BASIC ROUTES
========================= */

app.get("/", (req, res) => {
  res.send("TandT Chat Agora + Notification Server is running!");
});

/* =========================
   AGORA TOKEN
========================= */

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

  const token = require("agora-access-token").RtcTokenBuilder.buildTokenWithUid(
    APP_ID,
    APP_CERTIFICATE,
    channelName,
    userUid,
    require("agora-access-token").RtcRole.PUBLISHER,
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


/* =========================
   INCOMING CALL NOTIFICATION
   ========================= */

app.post("/incoming-call", async (req, res) => {
  try {
    const callerId = String(req.body.callerId || "").trim();
    const receiverId = String(req.body.receiverId || "").trim();
    const callerName = String(req.body.callerName || "T&T User").trim();

    if (!callerId || !receiverId) {
      return res.status(400).json({
        error: "callerId and receiverId are required"
      });
    }

    const receiverDoc = await db
      .collection("users")
      .doc(receiverId)
      .get();

    if (!receiverDoc.exists) {
      return res.status(404).json({
        error: "Receiver user not found"
      });
    }

    const userData = receiverDoc.data() || {};
    const fcmToken = userData.fcmToken;

    if (!fcmToken || typeof fcmToken !== "string") {
      return res.status(404).json({
        error: "Receiver has no valid FCM token"
      });
    }

    const callId =
      Date.now().toString() + "_" +
      Math.random().toString(36).substring(2, 10);

    const payload = {
      token: fcmToken,

      data: {
        type: "incoming_call",
        callId: callId,
        callerId: callerId,
        receiverId: receiverId,
        callerName: callerName
      },

      android: {
        priority: "high"
      }
    };

    const response = await messaging.send(payload);

    console.log("Incoming call notification sent:", {
      callId,
      callerId,
      receiverId,
      response
    });

    return res.json({
      success: true,
      callId: callId
    });

  } catch (error) {
    console.error(
      "Incoming call notification error:",
      error.message
    );

    return res.status(500).json({
      error: error.message
    });
  }
});

/* =========================
   FIRESTORE MESSAGE LISTENER
========================= */

let firestoreReady = false;

db.collectionGroup("messages").onSnapshot(
  (snapshot) => {
    if (!firestoreReady) {
      firestoreReady = true;

      console.log(
        `Firestore listener ready. Existing messages ignored: ${snapshot.size}`
      );

      return;
    }

    for (const change of snapshot.docChanges()) {
      if (change.type !== "added") {
        continue;
      }

      sendChatNotification(change.doc).catch((error) => {
        console.error(
          "Notification processing error:",
          error.message
        );
      });
    }
  },
  (error) => {
    console.error(
      "Firestore listener error:",
      error.message
    );
  }
);

/* =========================
   SEND FCM NOTIFICATION
========================= */

async function sendChatNotification(messageDoc) {
  const message = messageDoc.data();

  const senderId = message.senderId;
  const receiverId = message.receiverId;
  const type = message.type || "text";

  if (!receiverId || !senderId) {
    console.warn(
      "Message missing senderId or receiverId:",
      messageDoc.id
    );
    return;
  }

  const receiverDoc = await db
    .collection("users")
    .doc(String(receiverId))
    .get();

  if (!receiverDoc.exists) {
    console.warn(
      "Receiver user does not exist:",
      receiverId
    );
    return;
  }

  const userData = receiverDoc.data() || {};
  const fcmToken = userData.fcmToken;

  if (!fcmToken || typeof fcmToken !== "string") {
    console.warn(
      "Receiver has no valid FCM token:",
      receiverId
    );
    return;
  }

  let body = "رسالة جديدة";

  if (type === "text") {
    body = message.text || "رسالة جديدة";
  } else if (type === "image") {
    body = "صورة جديدة";
  } else if (type === "voice") {
    body = "رسالة صوتية";
  } else if (type === "file") {
    body = "ملف جديد";
  }

  const payload = {
    token: fcmToken,

    notification: {
      title: "T&T Chat",
      body: body
    },

    data: {
      chatId: String(messageDoc.ref.parent.parent?.id || ""),
      messageId: String(messageDoc.id),
      senderId: String(senderId),
      receiverId: String(receiverId),
      type: String(type)
    },

    android: {
      priority: "high",

      notification: {
        channelId: "tnt_chat_messages",
        sound: "default"
      }
    }
  };

  try {
    const response = await messaging.send(payload);

    console.log(
      "FCM notification SENT:",
      JSON.stringify({
        response,
        receiverId,
        messageId: messageDoc.id,
        type
      })
    );
  } catch (error) {
    console.error(
      "FCM notification FAILED:",
      JSON.stringify({
        error: error.message,
        receiverId,
        messageId: messageDoc.id,
        type
      })
    );
  }
}

/* =========================
   START SERVER
========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `TandT Chat server running on port ${PORT}`
  );
});
