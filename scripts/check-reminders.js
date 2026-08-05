/**
 * Checks every vehicle for services that are "due soon" or "overdue" and
 * sends a push notification via FCM. Designed to run as a one-off script
 * (e.g. from a GitHub Actions cron job) instead of a paid Firebase Cloud
 * Function — Firestore reads/writes and FCM sends are free on the Spark
 * (no-cost) Firebase plan; only Cloud Functions/Scheduler require billing.
 *
 * Requires a Firebase service account key, passed as the JSON string in the
 * FIREBASE_SERVICE_ACCOUNT environment variable. See README for how to
 * generate one and wire it up as a GitHub Actions secret.
 */
const admin = require("firebase-admin");

const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!saJson) {
  console.error("Missing FIREBASE_SERVICE_ACCOUNT environment variable.");
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saJson)) });
const db = admin.firestore();
const messaging = admin.messaging();

const SERVICE_TYPES = [
  { key: "oil_change", label: "Oil & filter change" },
  { key: "tire_rotation", label: "Tire rotation" },
  { key: "brake_inspection", label: "Brake inspection" },
  { key: "brake_fluid", label: "Brake fluid flush" },
  { key: "air_filter", label: "Air filter replacement" },
  { key: "fuel_filter", label: "Fuel filter change" },
  { key: "cabin_filter", label: "Cabin air filter" },
  { key: "battery_check", label: "Battery check" },
  { key: "coolant_flush", label: "Coolant flush" },
  { key: "transmission_fluid", label: "Transmission fluid" },
  { key: "spark_plugs", label: "Spark plugs" },
  { key: "timing_belt", label: "Timing belt" },
  { key: "wheel_alignment", label: "Wheel alignment" },
  { key: "ac_service", label: "A/C service" },
  { key: "wiper_blades", label: "Wiper blades" }
];

function daysBetween(isoA, isoB) {
  const a = new Date(isoA + "T00:00:00");
  const b = new Date(isoB + "T00:00:00");
  return Math.round((b - a) / 86400000);
}
function addDays(iso, days) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function intervalUsesKmOnly(record) {
  const km = Number(record.intervalKm) || 0;
  const days = Number(record.intervalDays) || 0;
  return km > 0 && days <= 0;
}

// Mirrors serviceEntriesForVehicle() in index.html.
function statusForEntry(vehicle, recsForEntry) {
  if (!recsForEntry.length) return { status: "none" };
  const last = recsForEntry[0];
  let mf = last.intervalKm > 0 ? ((vehicle.currentMileage || 0) - last.mileage) / last.intervalKm : 0;
  let df = 0;
  if (last.intervalDays) {
    const dueD = addDays(last.date, last.intervalDays);
    const span = daysBetween(last.date, dueD) || 1;
    const elapsed = daysBetween(last.date, todayISO());
    df = elapsed / span;
  }
  const fraction = intervalUsesKmOnly(last) ? mf : Math.max(mf, df);
  const status = fraction >= 1 ? "overdue" : fraction >= 0.85 ? "soon" : "ok";
  return { status };
}

async function sendToEmails(emails, title, body, data) {
  const uniqueEmails = Array.from(new Set(emails.filter(Boolean).map((e) => e.toLowerCase())));
  if (!uniqueEmails.length) return;

  const tokenSnaps = await Promise.all(
    uniqueEmails.map((email) => db.collection("pushTokens").where("email", "==", email).get())
  );
  const tokens = Array.from(new Set(tokenSnaps.flatMap((snap) => snap.docs.map((d) => d.id))));
  if (!tokens.length) return;

  const resp = await messaging.sendEachForMulticast({ tokens, notification: { title, body }, data: data || {} });

  const deletions = [];
  resp.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error && r.error.code;
      if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
        deletions.push(db.collection("pushTokens").doc(tokens[i]).delete());
      }
    }
  });
  if (deletions.length) await Promise.all(deletions);
}

async function main() {
  const [vehiclesSnap, recordsSnap, settingsSnap] = await Promise.all([
    db.collection("vehicles").get(),
    db.collection("records").get(),
    db.collection("settings").doc("station").get()
  ]);

  const adminEmails = (settingsSnap.exists && settingsSnap.data().adminEmails) || [];

  const recordsByVehicle = {};
  recordsSnap.forEach((docSnap) => {
    const r = { id: docSnap.id, ...docSnap.data() };
    (recordsByVehicle[r.vehicleId] = recordsByVehicle[r.vehicleId] || []).push(r);
  });
  Object.keys(recordsByVehicle).forEach((vid) => {
    recordsByVehicle[vid].sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (b.mileage || 0) - (a.mileage || 0);
    });
  });

  const notifyStateRef = db.collection("notifyState");
  let sentCount = 0;

  const jobs = [];
  vehiclesSnap.forEach((vSnap) => {
    const vehicle = { id: vSnap.id, ...vSnap.data() };
    const recs = recordsByVehicle[vehicle.id] || [];

    const customLabels = Array.from(
      new Set(recs.filter((r) => r.typeKey === "custom").map((r) => r.customLabel || "Other"))
    );
    const entries = SERVICE_TYPES.map((s) => ({ key: s.key, label: s.label, isCustom: false })).concat(
      customLabels.map((label) => ({ key: "custom", label, isCustom: true }))
    );

    entries.forEach((entry) => {
      const recsForEntry = recs.filter((r) =>
        entry.isCustom ? r.typeKey === "custom" && (r.customLabel || "Other") === entry.label : r.typeKey === entry.key
      );
      const { status } = statusForEntry(vehicle, recsForEntry);
      const safeLabel = entry.label.replace(/[\/\s]+/g, "-");
      const stateKey = `${vehicle.id}_${entry.key}_${safeLabel}`;

      jobs.push(
        (async () => {
          const stateDoc = await notifyStateRef.doc(stateKey).get();
          const prevStatus = stateDoc.exists ? stateDoc.data().status : "none";

          const shouldNotify = (status === "soon" || status === "overdue") && status !== prevStatus;
          if (shouldNotify) {
            const vehicleName = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Your vehicle";
            const title = status === "overdue" ? "Service overdue" : "Service due soon";
            const body = `${vehicleName}: ${entry.label} is ${status === "overdue" ? "overdue" : "coming up"}.`;
            await sendToEmails([vehicle.customerEmail, ...adminEmails], title, body, {
              vehicleId: vehicle.id,
              serviceKey: entry.key,
              status
            });
            sentCount++;
          }
          if (status !== prevStatus) {
            await notifyStateRef.doc(stateKey).set({ status, updatedAt: new Date().toISOString() });
          }
        })()
      );
    });
  });

  await Promise.all(jobs);
  console.log(`Done. Sent ${sentCount} notification(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
