# Brand code

This is the rulebook for everything the system shows or prints: screens, receipts, documents, labels, icons. Follow it for every new feature. If a design needs something this code doesn't allow, change this file first, then the code.

## 1. Colour — logo colours only

The system uses **only the five colours in the logo**. No greys, greens, reds, blues or gradients from anywhere else.

| Token | Hex | Name | Use it for |
|---|---|---|---|
| `--navy` | `#16376A` | Dream navy | Primary colour: menu, headings, buttons, table headers, totals bars, links, success states |
| `--orange` | `#FB8F11` | Community orange | Accent: active menu item, tab underline, top edge of figure cards, divider rules, warnings |
| `--bronze` | `#A16A1A` | Earth bronze | Errors, losses, negative amounts, "refunded"/"cancelled" stamps, box headings on documents |
| `--black` | `#010101` | Ink black | Body text; everything on thermal receipts and barcode labels |
| `--white` | `#FFFFFF` | Paper white | Backgrounds, text on navy |

**Allowed:** the same five colours at reduced opacity, for borders, hover states, zebra rows and soft backgrounds. Examples: `rgba(22, 55, 106, .16)` or `#16376A33` for lines, `#16376A0A` for zebra rows.

**Not allowed:**

- any other hex value
- colour-mixing with colours outside the logo
- gradients
- a dark mode with other colours

**Meaning of colours** (keep it consistent):

| Meaning | Colour |
|---|---|
| Normal, OK, paid, in stock | Navy |
| Needs attention, low stock, warning, active | Orange |
| Problem, loss, error, out of stock, refunded | Bronze |

All colours live in `src/styles.css` (`:root` tokens) and `src/lib/documents.js` (`DOC_CSS`). **Never hard-code a colour anywhere else.**

## 2. Logo

- Always show the **full logo**: the people symbol plus the "DREAM CITY / Empowering Communities" wordmark. Never redraw it, recolour it, stretch it, crop it or add effects.
- Place it on **white** only. On navy areas (menu, sign-in panel), put it in a white rounded box with at least 4 mm or 6 px of white space around it.
- Minimum sizes:

| Where | Minimum size |
|---|---|
| Sidebar | full sidebar width (about 210 px) |
| Sign-in page | 220 px |
| Phone top bar | 40 px high |
| A4 documents | 32 mm high, top-left |
| Thermal receipts | 62% of paper width, printed in greyscale |

- When the logo is shown, **don't repeat the business name or tagline** next to it, because the logo already contains them.
- The app icon (`public/icons/`) is a simplified mark: navy tile, white figure, orange and bronze arcs, white city skyline. Don't use it in place of the logo inside the app.

## 3. Typography

| Context | Font | Sizes |
|---|---|---|
| App screens | Inter, falling back to the system UI font | Body 15 px · H1 24 px · H2 17.6 px · labels 13 px, bold |
| A4 documents | Arial / Helvetica | Body 10.5 pt · document title 20 pt, uppercase, navy, letter-spaced · table headers 8.5 pt, uppercase |
| Thermal receipts | Arial / Helvetica | 11.5 px (80 mm), 10.5 px (58 mm) · total 1.35× and bold |

**Numbers:**

- Money is always shown with the currency code, for example **UGX 12,500**, using `money()`.
- Quantities use `num()`.
- Amounts are right-aligned.

**Dates:**

- Use the format **26 Oct 2026**, or **26 Oct 2026, 15:58** with a time.
- Always use `date()` or `dateTime()`, which apply the shop's time zone.

## 4. Writing style

- Plain English that shop staff understand: "Stock value", "Owed to suppliers", "Runs out soon". Avoid jargon unless it's on an accounting document.
- Write buttons as verbs: "Print statement", "Save adjustment", "Record payment".
- Errors say what to do next: "Enter a quantity for Sugar 1kg."

## 5. System-generated documents

Every A4 document is built with `documentHtml()` / `printDocument()` in `src/lib/documents.js`, so they all look the same. Each document has these parts, in order:

1. **Header**: logo and shop details (address, phone, email, TIN) on the left. The document title (navy, uppercase), document number and date on the right. An optional **stamp** (bronze outline) such as PAID, RECEIVED or REFUNDED.
2. **Orange rule**, 3 px.
3. **Two info boxes** with a thin navy outline and bronze uppercase headings: who the document is for, and the key facts.
4. **Line table**: navy header row with white uppercase labels, light navy zebra rows, numbers right-aligned.
5. **Totals**: sub-totals in bold with a navy top line; the **grand total in a solid navy bar** with white text.
6. Notes, if any.
7. **Signature lines**, 2–3 of them (for example "Prepared by", "Approved by").
8. **Footer**: a thin orange line, the shop name and tagline on the left, and "Printed <date> by <user>" on the right.

**Document numbers:**

| Document | Number format |
|---|---|
| Sales receipt | `<prefix>-000123` (prefix from Settings) |
| Stock adjustment | `ADJ-YYYYMMDD-0001` |
| Supplier return | `RTN-YYYYMMDD-0001` |
| Purchase order | `PO-…` |
| Expense | `EXP-…` |
| Customer payment | `PAY-xxxxxxxx` |

**Documents the system produces:**

| Document | Where to print it | Format |
|---|---|---|
| Sales receipt / refund receipt | Sell → after sale · Reports → Reprint | Thermal 58/80 mm (black only) or A4 (Settings → Printer paper) |
| Customer payment receipt | Customers → Receive payment | A4 |
| Customer statement | Customers → Statement → Print statement | A4 |
| Purchase order | Buy → Orders → Print | A4 |
| Goods received note | Buy → after recording a purchase or receiving an order | A4 |
| Supplier return note | Inventory → Supplier returns → Print | A4 |
| Stock adjustment note | Inventory → Adjust stock → Recent → Print | A4 |
| Stock count sheet | Count stock → Print count sheet | A4 |
| Payment voucher (expense) | Accounts → Expenses → Print | A4 |
| Financial statements (P&L, balance sheet, trial balance) | Accounts → Print financial statements | A4 |
| Price & barcode labels | Inventory → Labels | A4 sheet or 50×30 / 40×25 mm label rolls (black only) |

## 6. Thermal receipts and labels

Thermal printers print **black only**, so receipts and labels use black on white. The logo prints in greyscale.

A receipt has these parts, in order:

1. logo
2. shop details
3. **SALES RECEIPT** title between two heavy rules
4. receipt number, date, staff member and customer
5. item lines (name in bold, then "qty × price" with the amount)
6. items count, subtotal and discount
7. **TOTAL** in large type between heavy rules
8. payment method, cash given and change
9. a Code 128 barcode of the receipt number
10. thank-you line and "Keep this receipt for returns."

## 7. Screens

- **Sidebar**: navy background, large logo in a white box at the top, white menu text, an orange bar on the active item. Signed-in user at the bottom, with role and "Sign out" in orange.
- **Phones**: navy top bar and bottom bar with an orange edge; the active item is orange.
- **Cards**: white with a thin navy-tint border. Figure cards have a 3 px orange top edge and navy numbers.
- **Buttons**:
  - Primary: solid navy (black on hover).
  - Secondary: white with a navy outline.
  - Destructive: bronze.
- **Badges**: navy for OK, orange for warning, bronze for problems.

## 8. White-label note

Other shops replace the logo and can set their own brand colour (Settings → Brand colour). That colour replaces **navy only**. If a shop's logo has different colours, update the five tokens in `src/styles.css` and `DOC_CSS` to that logo's palette, and keep every other rule in this file.
