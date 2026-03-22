/** Curated Google Fonts for heading / body selectors (phase 4.5). */
export const GOOGLE_FONT_OPTIONS: string[] = [
  "Inter",
  "Playfair Display",
  "Lora",
  "Merriweather",
  "DM Sans",
  "Space Grotesk",
  "Libre Baskerville",
  "Source Sans 3",
  "Nunito",
  "Poppins",
  "Montserrat",
  "Open Sans",
  "Raleway",
  "Work Sans",
  "Fraunces",
  "Crimson Pro",
  "Outfit",
  "Sora",
  "Manrope",
  "IBM Plex Sans",
];

export function googleFontsStylesheetHref(headingFont: string, bodyFont: string): string {
  const families = [headingFont, bodyFont]
    .filter(Boolean)
    .map((f) => f.trim().replace(/ /g, "+"))
    .filter((v, i, a) => a.indexOf(v) === i);
  if (families.length === 0) return "";
  const q = families.map((f) => `family=${f}:wght@300;400;500;600;700`).join("&");
  return `https://fonts.googleapis.com/css2?${q}&display=swap`;
}
