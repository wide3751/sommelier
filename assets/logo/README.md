# Logo

| 檔案 | 用途 |
|---|---|
| `logo.png` | 精緻插畫版，README 頁首使用 |
| `logo-flat.png` | 扁平版，小尺寸與單色場合 |
| `logo-handdrawn.png` | 手繪版 |
| `logo-source.html` | 產生三版的原始檔 |

字體為 [DM Serif Display](https://fonts.google.com/specimen/DM+Serif+Display)（SIL Open Font License）。重新產生（`s` 為 `flat`、`hd`、`ill`）：

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=3 --virtual-time-budget=8000 --default-background-color=00000000 \
  --window-size=436,172 --screenshot=logo.png "file://$PWD/logo-source.html?s=ill"
```
