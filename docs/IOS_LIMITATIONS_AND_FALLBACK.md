# iOS LIMITATIONS & QR FALLBACK STRATEGY
**Date:** 23 July 2026  
**Status:** Architectural Decision Required  
**Impact:** High (iPhone users = ~40% of Kenyan market)

---

## THE PROBLEM

**iOS Core NFC Restrictions:**
- ❌ **No HCE (Host Card Emulation)** - Apple Pay monopoly
- ❌ **No APDU access** - Cannot emulate payment cards
- ✅ **Reader mode only** - Can read tags, cannot act as card
- ✅ **Apple Pay** - Requires Apple MFI certification ($$$) + bank partnership

**Result:** Consumer Wallet app **cannot work on iPhone** for tap-to-pay.

---

## THE SOLUTION: QR Code Fallback

**Architecture:**

iPhone Consumer Merchant (Android/Sunmi)
│ │
│ 1. Open Web App │
│ 2. Scan Merchant QR │
│───────────────────────────────────>│
│ │
│ 3. Enter Amount │
│ 4. Confirm M-Pesa STK Push │
│<───────────────────────────────────│
│ │
│ 5. Enter PIN (on phone) │
│ 6. Payment Confirmed │
│───────────────────────────────────>│

text


**Implementation Status:**
- ✅ Backend supports `source: "QR_CODE"` 
- ✅ Web app has consumer portal
- ⚠️ Need to verify QR generation in merchant app
- ⚠️ Need responsive design for iPhone Safari

---

## TECHNICAL IMPLEMENTATION

### Merchant QR Generation
**Current:** Static NTAG215 stickers with `orchestratepay://` URI  
**Required:** Dynamic QR for iPhone users

**Options:**

**Option A: Static QR + Web Redirect (Recommended)**
- Merchant displays QR with URL: `https://orchestratepay.co.ke/pay/{merchantId}`
- iPhone scans → Safari opens web app
- Consumer enters amount → Backend fires STK Push
- **Pros:** Works with existing stickers, no app needed
- **Cons:** Extra step (enter amount manually)

**Option B: Dynamic QR (Amount Embedded)**
- Merchant app generates QR with pre-filled amount
- QR contains: `https://orchestratepay.co.ke/pay/{merchantId}?amount=1000`
- **Pros:** Faster checkout
- **Cons:** Requires merchant to enter amount first, then show QR

**Decision:** Implement **Option A** for stickers, **Option B** for merchant app "Show QR" button.

---

## UI/UX REQUIREMENTS

### iPhone Consumer Flow
1. **No app download required** (Progressive Web App)
2. **Camera permission** for QR scanning
3. **M-Pesa STK Push** native integration
4. **Safari/Chrome support** (WebRTC not needed, just HTTPS)

### Responsive Breakpoints
```css
/* iPhone SE/12/13/14/15 */
@media (max-width: 430px) {
  /* Tap targets min 44px */
  /* Font size min 16px (prevents zoom) */
}
COMPETITIVE ANALYSIS
Solution	iPhone Support	Android Support	Cost
Current (NFC HCE)	❌ No	✅ Yes	Low
QR Fallback	✅ Yes	✅ Yes	Low
Apple Pay	✅ Yes	❌ No	High ($$MFI + certification)
Flutter + Stripe	✅ Yes	✅ Yes	Medium (3rd party fees)
Recommendation: QR fallback covers 100% of market, avoids Apple MFI costs.

IMPLEMENTATION CHECKLIST
 Verify https://orchestratepay.co.ke/pay/{merchantId} endpoint exists
 Test STK Push from web (not just app)
 Add QR code generation to merchant dashboard
 Implement PWA manifest for iPhone "Add to Home Screen"
 Test on iPhone 12/13/14/15 (Safari + Chrome)
 Optimize for low-bandwidth (2G/3G Kenya networks)
APDU vs QR Trade-offs
Feature	NFC HCE (Android)	QR Code (iOS)
Speed	2-3 seconds (tap)	5-8 seconds (scan + enter)
Offline	❌ Requires backend	❌ Requires backend
Security	Token-based (90s TTL)	Token-based (90s TTL)
UX	Tap & pay	Scan, enter amount, pay
Hardware	NFC required	Camera required
Conclusion: QR is acceptable fallback for iPhone given market constraints.

DOCUMENTATION FOR JUNIOR DEV
What to tell the client:

"iPhone users will use QR code scanning instead of tap-to-pay. This is an Apple platform limitation, not a bug. The experience is slightly slower (5s vs 3s) but fully functional. Native Apple Pay requires $100K+ certification and bank partnership, which is not feasible for MVP."

Code changes needed:

Web app: Ensure /pay/{merchantId} route works standalone
Merchant app: Add "Show QR" button next to NFC tap
Backend: Verify QR_CODE source works with existing transaction flow
END OF DOCUMENT
