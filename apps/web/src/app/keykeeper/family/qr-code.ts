// Keykeeper: QR codes drawn in the browser with upstream's QR library
// (QRious), which the web vault already serves for two-step login's setup
// (scripts/qrious.min.js). Nothing is sent anywhere to draw one.

type QRiousInstance = { toDataURL(mime?: string): string };
type QRiousConstructor = new (options: {
  value: string;
  size: number;
  level?: "L" | "M" | "Q" | "H";
}) => QRiousInstance;

const qrious = () => (window as unknown as { QRious?: QRiousConstructor }).QRious;

let loading: Promise<void> | null = null;

/** Loads upstream's QRious once, if it isn't loaded yet. */
function loadQrious(): Promise<void> {
  if (qrious() != null) {
    return Promise.resolve();
  }
  loading ??= new Promise<void>((resolve) => {
    const script = document.createElement("script");
    script.src = "scripts/qrious.min.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      resolve();
    };
    document.body.appendChild(script);
  });
  return loading;
}

/** A QR code of `value` as an image's address (a PNG data URL), or null if QRious didn't load. */
export async function qrCodeImage(value: string, size = 220): Promise<string | null> {
  await loadQrious();
  const QRious = qrious();
  if (QRious == null) {
    return null;
  }
  return new QRious({ value, size, level: "M" }).toDataURL("image/png");
}
