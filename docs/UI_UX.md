# UI and UX

## Product principle

Ntumba is a focused payment-request tool, not a wallet or customer account. The merchant's primary
journey is:

```text
Get paid → Create request → Share request → View status
```

The merchant makes three required decisions:

1. Amount in Kwacha.
2. Receive in Mobile Money or Bitcoin.
3. Destination for that receive asset.

The merchant never chooses how the customer pays. Guest checkout derives and presents supported
methods from the request's provider capabilities.

## Information architecture

Merchant navigation is a persistent mobile bottom bar with three destinations:

- **Get paid** (`/`) — create a request.
- **Activity** (`/activity`) — device-local requests and receipts.
- **Settings** (`/settings`) — device-local business name, preference and remembered destinations.

The active destination uses colour, a top rule and visible **Current** text. Guest checkout
(`/pay/:publicId`) has a separate shell and never shows merchant navigation.

`/requests/:localId` is a device-local merchant share/status screen. `localId` and `publicId` are
different opaque identifiers. Raw destinations do not appear in URLs.

## Screen behavior

### Get paid

- Starts with a blank amount.
- Uses large Mobile Money and Bitcoin receive cards with text, icons and a selected check.
- Reveals only the destination fields relevant to the receive asset.
- Keeps reference behind **Add reference**.
- Loads the optional business name and remembered destinations from Settings.
- Disables creation until amount, destination and connection are available.
- Explains offline and session-only storage states in place.

### Share request

- Leads with amount, receive asset, masked destination, optional reference and countdown.
- Shows a scannable QR code and one strong **Share request** action.
- Provides **Copy link** with live success/failure feedback.
- Shows the safe read-only link and offers customer checkout preview.

### Guest checkout

- Leads with request amount, merchant receive asset and expiry.
- Shows customer payment methods as large cards.
- Refreshes request data after method selection before showing quote details.
- Presents rate, fee and countdown in plain language.
- Uses one action for the selected rail.
- Describes provider-direct behavior without custody jargon.
- Never calls direct Bitcoin paid without verification.
- Shows expired, unavailable, loading and development-fake states explicitly.

### Activity

- Uses **No requests yet** as the empty-state heading.
- Shows amount, receive asset, optional reference, plain status with icon and timestamps.
- Reads only local browser data.

### Settings

- Stores business display name, preferred receive asset and remembered destinations locally.
- Reports whether persistent IndexedDB or session-memory fallback is active.
- Requires a dialog confirmation before clearing local data.
- Explains that clearing removes this browser's settings, requests and receipts and does not claim
  to delete server/provider records.

## Visual system

The interface is light-first, high-contrast and intentionally restrained.

| Token | Value | Use |
| --- | --- | --- |
| Page | `#F5F3ED` | App background |
| Surface | `#FFFFFF` | Cards and controls |
| Text | `#071A12` | Primary text and dark icons |
| Muted | `#637169` | Secondary copy |
| Border | `#DCE4DF` | Card and control separation |
| Primary | `#62E6A7` | Main action |
| Primary pressed | `#4FD391` | Active action |
| Bitcoin | `#F5A24A` | Bitcoin accent only |
| Error | `#C8463A` | Destructive/error communication |

There are no gradients. Borders and spacing carry hierarchy; shadows are minimal. Icons are
inline, stroke-based SVG and always paired with text when they communicate an action or status.

## Responsive layout

- Mobile is the default, reviewed at 390×844 CSS pixels.
- Interactive targets are at least 48px high.
- Bottom navigation includes safe-area padding.
- Content has enough bottom padding to remain reachable above fixed navigation.
- Desktop is reviewed at 1440×900 and keeps the creation task dominant, with guidance in a
  secondary column rather than stretching the form.
- Route changes reset scroll to the top.

## Accessibility and language

- Semantic headings, labels, fieldsets, buttons, links, status regions and dialog are used.
- Keyboard focus is visibly outlined.
- Selection and active navigation never rely on colour alone.
- Status messages use icons plus plain text.
- Motion respects `prefers-reduced-motion`.
- Text uses customer language such as **Waiting for payment**, **Paying merchant** and
  **Merchant paid**. Provider names, intent IDs, webhooks and internal state labels stay out of
  customer-facing copy.

## Review artifacts

Playwright refreshes the visual-review screenshots in `artifacts/ui-review/` for Get paid, Share,
guest checkout, Activity and the desktop Get paid layout. These artifacts supplement functional
assertions; they are not pixel-snapshot tests.
