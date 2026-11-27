# PartWise demo script (about 5 minutes)

Before you start, click **Reset demo data** in the sidebar. Use a wide browser window so the live phone preview sits next to the console.

## 1. The problem (20s): Advisor Console
"This is a Tekion ARC service advisor's morning: six repair orders. Today every part line becomes a new-part quote, even when a tested, cheaper, greener part is sitting in a sister store 8 km away."

## 2. The hero repair order (90s): RO-24817, 2017 Hyundai i20
- Click **Run PartWise**. Point at the four pipeline steps.
- **Brake pads → NEW ONLY.** "Safety rule. PartWise even found a recycled set in Indiranagar and blocked it." Expand to show the excluded option.
- **Alternator → RECYCLED · RECOMMENDED.** "Grade-A reman from Indiranagar: saves ₹3,500, ready today instead of tomorrow, 12-month warranty, ≈12 kg CO₂ avoided." Expand the options:
  - Score bars show *why* (price, wait, CO₂, warranty, car-age fit).
  - Electronic City: grade C, 3-month warranty → excluded. Hoskote: 36 km → outside the 30 km radius.
  - The part has sat idle 14 months, so it's dead stock turned into a sale.
- **AC compressor → COVERED · ₹0.** Extended warranty.
- Click **What the AI saw**: "No customer personal data reaches the LLM. It explains; rules and scoring decide."

## 3. One-click approve and the customer's phone (60s)
- **Approve & send to customer.** Show the SMS and the live phone.
- On the phone, the customer sees 2 options, *Recommended · saves ₹3,500*, and the plain-language reason.
- Tap **Confirm my choices**: **+120 Green Points, 380 / 500** to the next reward.
- Back on the console: *Customer approved*, transfer Indiranagar → Koramangala requested in ARC, choice written back.

## 4. Proof it's auditable (20s): Audit Log
Filter `RO-24817`: rule hits, scores, AI mode, approval, SMS, customer choice, transfer, ARC write-back, points.

## 5. Dealer control (40s): Rules & What-if
- Pick RO-24820 (Scorpio). Click **Fastest**: the turbocharger pick flips from recycled-Yelahanka to reman-Whitefield, highlighted *PICK CHANGES*.
- "Policy is a versioned YAML file per dealer or OEM, validated before publish." Try changing `min_grade: B` to `Z` to show it gets rejected.

## 5b. Real customer input, live (60s)
- Hand a judge your phone (or open **Customer booking page ↗** from the sidebar) at `http://<laptop-ip>:8000/book`. They type their own car and problem, e.g. "AC blows warm air and the car struggles to start".
- They land on "Your advisor is preparing your estimate", with the AI's likely parts listed.
- On the laptop, the booking appears in the Advisor Console within 5 seconds, tagged ONLINE BOOKING. Open it, adjust the lines (or add a part that isn't listed), **Run PartWise**, **Approve**.
- The judge's phone turns into their estimate by itself. They choose and get Green Points.

## 5c. Voice booking and learning (60s)
- On `/book`, tap **Tap to speak** and describe the problem in Hindi or Kannada. It's transcribed, translated, and the likely parts appear for the advisor with a VOICE NOTE tag.
- On **Rules & What-if**, show **Learned from customer decisions**: "Customers weigh warranty about 3.8× more than our policy assumed. The model predicts their choices 78% of the time, versus 69% for a naive guess. CO₂ is a goal we protect, so learning can never lower it." Click **Try in What-if**, then **Publish learned weights**: a new audited rules version.

## 6. Business case (40s): Impact Dashboard
- 90-day pilot: tonnes of CO₂ avoided, ₹ lakhs saved for customers, recycled uptake rising week over week.
- **One recommendation, three winners**: customer savings, idle stock turned into sales for the dealer group, and Tekion revenue (per-rooftop subscription plus transfer fees).
- **CO₂ report (CSV)**: "the reporting product for dealer groups and OEMs."

## Close (10s)
"Only Tekion can do this, because ARC already has live stock from every rooftop in one place. PartWise plugs into existing repair orders with no new hardware."

### If asked
- **Where's the AI?** Two places: it turns the customer's words into suggested parts (catalog IDs only), and it writes the explanations, with a guard that rejects any ₹ figure not in the decision data. It runs on a free Groq key in `backend/.env`; the sidebar shows which mode is on. Rules and scoring make the decision, never the LLM.
- **Can the advisor disagree?** Yes. Pick another eligible option. A reason is required and audited. Safety and warranty lines are locked.
- **New scenario live?** Use **New repair order**: any vehicle, any parts.
