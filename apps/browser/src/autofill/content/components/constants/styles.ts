import { Theme } from "@bitwarden/common/platform/enums";

import { IconProps } from "../common-types";

// Keykeeper: PassBundle's palettes for what the extension draws inside
// websites (the save bar and its messages), as the web vault and the popup
// have them (brand/look.css): the brand green, from brand/apply.mjs's palette
// for #1F6F5C, and grays tinted toward it, so dark is green-black, not navy.
// Danger, warning, and success keep upstream's colors.
const lightTheme = {
  transparent: {
    hover: `rgb(0 0 0 / 0.02)`,
  },
  shadow: `rgba(187, 205, 199)`,
  primary: {
    100: `rgba(226, 236, 234)`,
    300: `rgba(121, 169, 157)`,
    600: `rgba(31, 111, 92)`,
    700: `rgba(24, 87, 72)`,
  },
  secondary: {
    100: `rgba(233, 239, 237)`,
    300: `rgba(187, 205, 199)`,
    500: `rgba(108, 132, 124)`,
    600: `rgba(78, 99, 92)`,
    700: `rgba(58, 79, 72)`,
  },
  success: {
    100: `rgba(226, 236, 234)`,
    600: `rgba(121, 169, 157)`,
    700: `rgba(24, 87, 72)`,
  },
  danger: {
    100: `rgba(255, 236, 239)`,
    600: `rgba(203, 38, 58)`,
    700: `rgba(149, 27, 42)`,
  },
  warning: {
    100: `rgba(255, 248, 228)`,
    600: `rgba(255, 191, 0)`,
    700: `rgba(172, 88, 0)`,
  },
  info: {
    100: `rgba(226, 236, 234)`,
    600: `rgba(121, 169, 157)`,
    700: `rgba(24, 87, 72)`,
  },
  art: {
    primary: `rgba(18, 48, 42)`,
    accent: `rgba(143, 217, 193)`,
  },
  text: {
    main: `rgba(24, 34, 31)`,
    muted: `rgba(78, 99, 92)`,
    contrast: `rgba(255, 255, 255)`,
    alt2: `rgba(255, 255, 255)`,
    code: `rgba(192, 17, 118)`,
  },
  background: {
    DEFAULT: `rgba(255, 255, 255)`,
    alt: `rgba(243, 247, 245)`,
    alt2: `rgba(31, 111, 92)`,
    alt3: `rgba(24, 87, 72)`,
    alt4: `rgba(13, 47, 39)`,
  },
  brandLogo: `rgba(31, 111, 92)`,
  passwordSpecial: `rgba(184, 0, 23)`,
  passwordNumber: `rgba(24, 87, 72)`,
};

const darkTheme = {
  transparent: {
    hover: `rgb(255 255 255 / 0.03)`,
  },
  shadow: `rgba(0, 0, 0)`,
  primary: {
    100: `rgba(13, 47, 39)`,
    300: `rgba(24, 87, 72)`,
    600: `rgba(121, 169, 157)`,
    700: `rgba(197, 218, 213)`,
  },
  secondary: {
    100: `rgba(38, 52, 47)`,
    300: `rgba(58, 79, 72)`,
    500: `rgba(108, 132, 124)`,
    600: `rgba(142, 166, 158)`,
    700: `rgba(160, 182, 174)`,
  },
  success: {
    100: `rgba(11, 111, 21)`,
    600: `rgba(107, 241, 120)`,
    700: `rgba(191, 236, 195)`,
  },
  danger: {
    100: `rgba(149, 27, 42)`,
    600: `rgba(255, 78, 99)`,
    700: `rgba(255, 236, 239)`,
  },
  warning: {
    100: `rgba(172, 88, 0)`,
    600: `rgba(255, 191, 0)`,
    700: `rgba(255, 248, 228)`,
  },
  info: {
    100: `rgba(24, 87, 72)`,
    600: `rgba(121, 169, 157)`,
    700: `rgba(226, 236, 234)`,
  },
  art: {
    primary: `rgba(232, 242, 238)`,
    accent: `rgba(143, 217, 193)`,
  },
  text: {
    main: `rgba(232, 242, 238)`,
    muted: `rgba(160, 182, 174)`,
    contrast: `rgba(12, 21, 19)`,
    alt2: `rgba(255, 255, 255)`,
    code: `rgba(255, 143, 208)`,
  },
  background: {
    DEFAULT: `rgba(20, 32, 29)`,
    alt: `rgba(12, 21, 19)`,
    alt2: `rgba(34, 47, 43)`,
    alt3: `rgba(38, 52, 47)`,
    alt4: `rgba(12, 21, 19)`,
  },
  brandLogo: `rgba(255, 255, 255)`,
  passwordSpecial: `rgba(255, 141, 133)`,
  passwordNumber: `rgba(143, 217, 193)`,
};

export const themes = {
  light: lightTheme,
  dark: darkTheme,

  // For compatibility
  system: lightTheme,
};

export const spacing = {
  4: `16px`,
  3: `12px`,
  2: `8px`,
  "1.5": `6px`,
  1: `4px`,
};

export const border = {
  radius: {
    large: `8px`,
    full: `9999px`,
  },
};

// Keykeeper: PassBundle's typeface, from the page's theme (brand/fonts.css),
// where upstream names Inter.
export const fontFamily = `var(--font-sans, Inter, sans-serif)`;

export const typography = {
  body1: `
    line-height: 24px;
    font-family: ${fontFamily};
    font-size: 16px;
  `,
  body2: `
    line-height: 20px;
    font-family: ${fontFamily};
    font-size: 14px;
  `,
  helperMedium: `
    line-height: 16px;
    font-family: ${fontFamily};
    font-size: 12px;
  `,
};

export const ruleNames = {
  fill: "fill",
  stroke: "stroke",
} as const;

type RuleName = (typeof ruleNames)[keyof typeof ruleNames];

/*
 * `color` is an intentionally generic name here, since either fill or stroke may apply, due to
 * inconsistent SVG construction. This consequently precludes dynamic multi-colored icons here.
 */
export const buildIconColorRule = (color: string, rule: RuleName = ruleNames.fill) => `
  ${rule}: ${color};
`;

export const resolveIconColor = ({ color, disabled, theme }: IconProps) =>
  disabled ? themes[theme].secondary["300"] : color || themes[theme].text.main;

export const animations = {
  spin: `
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(359deg);
    }
  `,
};

export function scrollbarStyles(theme: Theme, color?: { thumb?: string; track?: string }) {
  const thumbColor = color?.thumb || themes[theme].secondary["500"];
  const trackColor = color?.track || themes[theme].background.alt;

  return {
    /* FireFox & Chrome support */
    default: `
      scrollbar-color: ${thumbColor} ${trackColor};
    `,
    /* Safari Support */
    safari: `
      ::-webkit-scrollbar {
        overflow: auto;
      }
      ::-webkit-scrollbar-thumb {
        border-width: 4px;
        border-style: solid;
        border-radius: 0.5rem;
        border-color: transparent;
        background-clip: content-box;
        background-color: ${thumbColor};
      }
      ::-webkit-scrollbar-track {
        ${trackColor};
      }
      ::-webkit-scrollbar-thumb:hover {
        ${themes[theme].secondary["600"]};
      }
    `,
  };
}
