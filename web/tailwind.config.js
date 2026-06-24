/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Lumen palette - violet accents on white-leaning surface.
        lumen: {
          // backgrounds
          bgStart: "#F4F0FF",
          bgEnd:   "#FFFFFF",
          // primary violet accent
          50:  "#F4F0FF",
          100: "#EDE5FF",
          200: "#D9CCFF",
          300: "#BFA8FB",
          400: "#A78BFA",  // secondary
          500: "#8B5CF6",  // primary
          600: "#7C3AED",  // primary hover
          700: "#6D28D9",
          // text
          ink:    "#1A1626",
          muted:  "#6B6480",
          // status
          success: "#10B981",
          warning: "#F59E0B",
          error:   "#EF4444",
          // surface
          surface: "#FFFFFF",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["JetBrains Mono", "Geist Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        xs:    ["0.75rem",  { lineHeight: "1.5" }],
        sm:    ["0.875rem", { lineHeight: "1.5" }],
        base:  ["1rem",     { lineHeight: "1.5" }],
        lg:    ["1.25rem",  { lineHeight: "1.4" }],
        xl:    ["1.5625rem",{ lineHeight: "1.3", letterSpacing: "-0.01em" }],
        "2xl": ["1.75rem", { lineHeight: "1.25", letterSpacing: "-0.015em" }],
        "3xl": ["2.5rem",  { lineHeight: "1.2",  letterSpacing: "-0.02em" }],
      },
      borderRadius: {
        xl:  "1rem",
        "2xl": "1.5rem",
      },
      boxShadow: {
        lumen: "0 8px 32px rgba(139, 92, 246, 0.08)",
        "lumen-lg": "0 16px 48px rgba(139, 92, 246, 0.12)",
      },
      backgroundImage: {
        "lumen-gradient":
          "linear-gradient(135deg, #F4F0FF 0%, #FFFFFF 100%)",
      },
      animation: {
        "fade-in":   "fadeIn   200ms ease-out",
        "pulse-soft":"pulseSoft 2.4s ease-in-out infinite",
      },
      keyframes: {
        fadeIn:    { "0%": { opacity: "0", transform: "translateY(4px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        pulseSoft: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.6" } },
      },
    },
  },
  plugins: [],
};
