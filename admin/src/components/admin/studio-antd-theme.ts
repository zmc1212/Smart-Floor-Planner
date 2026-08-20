import { theme, type ThemeConfig } from 'antd';

const studioFontFamily =
  '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", "Helvetica Neue", Arial, sans-serif';

/**
 * Optional Ant Design theme tokens for AI studio shells that need night/day overrides
 * beyond the shared Admin green `AdminAntdProvider` (fullscreen create/scenarios).
 */
export const studioDarkAntdTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#7047ff',
    colorInfo: '#7047ff',
    colorBgElevated: '#1b1c20',
    colorBgContainer: '#222226',
    colorBorder: '#37373b',
    colorBorderSecondary: 'rgba(255, 255, 255, 0.1)',
    colorText: '#f5f5f5',
    colorTextPlaceholder: '#77777e',
    borderRadius: 8,
    fontFamily: studioFontFamily,
  },
  components: {
    Button: {
      defaultBg: '#24252b',
      defaultColor: '#f0f0f3',
      defaultBorderColor: 'rgba(255, 255, 255, 0.12)',
      defaultHoverBg: '#303138',
      defaultHoverColor: '#ffffff',
      defaultHoverBorderColor: 'rgba(255, 255, 255, 0.24)',
    },
    Select: {
      optionSelectedBg: 'rgba(255, 255, 255, 0.08)',
      optionSelectedColor: '#ffffff',
    },
    Modal: {
      contentBg: '#1b1c20',
      headerBg: '#1b1c20',
      titleColor: '#f5f5f5',
    },
    Input: {
      colorBgContainer: '#1d1e23',
    },
  },
};

export const studioLightAntdTheme: ThemeConfig = {
  token: {
    colorPrimary: '#16a34a',
    colorInfo: '#16a34a',
    colorSuccess: '#16a34a',
    colorBorderSecondary: '#e5e9e5',
    borderRadius: 8,
    fontFamily: studioFontFamily,
  },
};
