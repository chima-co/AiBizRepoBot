// ai.js — ShopBoss AI: Deep industry intelligence for 24 Nigerian sectors
function getClient() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.includes("your_") || key.length < 20)
    throw new Error("ANTHROPIC_API_KEY not set. Add it in Railway Variables → get key at console.anthropic.com");
  const Anthropic = require("@anthropic-ai/sdk");
  return new Anthropic({ apiKey: key });
}

const INDUSTRY_PROFILES = {
  "Agriculture": {
    context: `You advise Nigerian farmers and agribusiness owners. Know this:
OPERATIONS: Wet season (Apr-Oct south), dry season (Nov-Mar). Crops: maize, cassava, yam, rice, tomato, pepper, soybean, groundnut, plantain, cocoa, palm oil.
COSTS: Seeds, fertiliser (NPK/urea), pesticides, herbicides, farm labour (₦2,000-5,000/day casual), irrigation, storage, transport to market.
KEY RISKS: Post-harvest loss (30-40% without cold chain), price collapse at peak harvest, input cost inflation, AFEX/WACOT commodity exchange pricing.
METRICS: Yield/hectare, cost/kg produced, farm gate vs. market price spread, input-to-revenue ratio.
NICHES: Organic farming, OLAM/Flour Mills contract farming, cooperative aggregation, value-added processing (garri/flour/palm oil), export-grade produce.`,
    quickTips: ["Track cost per kg to know real margin","Set stock alerts before market day","Record inputs as expenses immediately","Compare farm gate vs. market price weekly"],
    keywords: ["harvest","yield","farm gate","offtake","input cost","cropping season","post-harvest","cold chain","cooperative","agro-dealer","smallholder","produce","AFEX"],
    commands: ["/sale — record produce sale","/expense — log seeds/fertiliser/labour","/stockin — add harvest to inventory","/lowstock — alert before market day","/product — add each crop with cost price","/supplier — log agro-input dealers"],
  },
  "Logistics": {
    context: `You advise Nigerian logistics, haulage, and delivery business owners.
OPERATIONS: Last-mile, intercity haulage, fleet management. Revenue: per-trip, retainer, per-kg/tonne.
COSTS: Fuel (biggest variable — track daily), driver salary, vehicle maintenance, tolls, loading labour, insurance, FRSC permit costs.
KEY METRICS: Revenue per trip, fuel cost % of revenue (target <40%), vehicle utilisation, idle days per vehicle, delivery success rate.
NICHES: E-commerce fulfillment (Jumia logistics partners), cold chain, LADOL dangerous goods, container haulage, 3PL warehousing.
PAIN POINTS: Fuel scarcity, breakdowns on Lagos-Ibadan expressway, driver pilfering, APM/Eto logistics app compliance.`,
    quickTips: ["Fuel should be <40% of trip revenue","Log each trip separately with route","Track vehicle downtime as lost revenue","Maintenance reminders by mileage not time"],
    keywords: ["trip","fleet","driver","fuel","haulage","delivery","waybill","manifest","tonnage","dispatch","logistics partner","FRSC","Eto","APM"],
    commands: ["/sale — record trip payment","/expense — fuel/tolls/maintenance","/product — set up route types as products","/staff — manage drivers and dispatchers","/payroll — driver salaries and trip bonuses","/order — delivery orders with route"],
  },
  "Retail": {
    context: `You advise Nigerian retail shop owners (provision, supermarket, kiosk, general store).
OPERATIONS: High-frequency, low-margin. Stock turnover is survival. POS banking commission is extra revenue.
FAST-MOVERS: Coca-Cola, Peak milk, Indomie, Golden Morn, sugar, semovita, groundnut oil, Cowbell, toiletries, sachet water.
METRICS: Gross margin/SKU, stock turnover ratio, daily sales vs. target, shrinkage rate, top 20 SKUs by revenue.
COST: COGS (60-75%), rent, staff, generator (Lagos/PH critical), restocking transport.
NICHES: POS banking agent (OPay/Moniepoint), FMCG distribution point, mini-mart, neighbourhood convenience, open market.`,
    quickTips: ["Top 20 products = 80% of revenue — know them by memory","Flag unsold items after 2 weeks","Daily break-even in ₦ — hit it before closing","Track shrinkage weekly (theft/damage)"],
    keywords: ["FMCG","SKU","stock turnover","shrinkage","restock","credit customers","POS","provision","walk-in","fast-moving","daily target","shelf","Indomie"],
    commands: ["/sale — every sale by product","/inventory — full stock list","/lowstock — run every morning","/stockin — supplier deliveries","/revenue — daily vs. weekly vs. monthly","/profit — real margin after COGS"],
  },
  "Wholesale": {
    context: `You advise Nigerian wholesale distributors and dealers (Onitsha, Alaba, Mile 12, Aba, Kano markets).
REVENUE: Price spread 10-30% margin, volume discounts earned from manufacturer.
KEY RISK: Trade credit exposure. Track who owes you and for how long. Nigerian wholesale is credit-driven.
METRICS: Gross margin/product line, days sales outstanding, inventory turnover, credit exposure per customer.
COST: COGS, transport from source, storage, credit losses, staff.
NICHES: Food commodities (rice/flour/sugar/oil), building materials, pharma wholesale, electronics, agro-inputs, auto-parts.`,
    quickTips: ["Know your total credit exposure at all times","Calculate margin per product line separately","Reorder point = (weekly sales × lead time) + safety stock","Grade customers by payment speed"],
    keywords: ["trade credit","bulk","distributor","dealer","margin","product line","offtake","supply chain","retail customer","credit exposure","Onitsha","cartons","tonnage"],
    commands: ["/sale — bulk sales with customer name","/stockin — purchases from manufacturers","/supplier — supplier list with pricing","/product — each product line with margins","/expenses — transport/storage/loading","/profit — margin per period"],
  },
  "Manufacturing": {
    context: `You advise Nigerian manufacturing and production businesses.
OPERATIONS: Raw material → production → finished goods → distribution.
Sectors: food processing (garri/flour/oil), garment/textile, furniture, soap/detergent, plastic, block-making, printing, fabrication.
METRICS: Production yield (% raw material → output), cost/unit, capacity utilisation %, downtime hours, waste rate.
COST: Raw materials (50-70%), energy (generator/NERC electricity), direct labour, equipment maintenance, packaging.
NICHES: OEM production, export manufacturing (leather/textiles), agro-processing, artisan/cottage.`,
    quickTips: ["Cost/unit must include generator fuel — it changes everything","Yield rate: 100kg raw→75kg output = 25% waste — track it","Log downtime (breakdown/power) as lost revenue","Break-even units = fixed costs ÷ unit margin"],
    keywords: ["production run","raw material","yield","finished goods","WIP","capacity","downtime","batch","unit cost","output","processing","factory gate","assembly"],
    commands: ["/product — finished goods with full unit cost","/stockin — add produced goods after each run","/expense — raw materials/energy/labour per batch","/sale — factory-gate sales","/supplier — raw material sources","/analytics — production cost vs. revenue"],
  },
  "Pharmacy": {
    context: `You advise Nigerian pharmacies and patent medicine dealers (PMD).
CRITICAL: Expiry date management = FIFO always. Expired drugs = 100% loss + PCN/NAFDAC sanctions.
METRICS: Gross margin by category (Rx ~20%, OTC ~35-50%, cosmetics ~50%), expired write-offs, days of stock on hand, controlled drug reconciliation.
FAST-MOVERS: Paracetamol, Amoxicillin, Metronidazole, Omeprazole, Vitamins (A/C/D), Coartem, ORS, Lonart, Artemether, Azithromycin.
NICHES: Hospital supply chain, community pharmacy, pharmaceutical wholesale, PMD, online pharmacy (Lagos/Abuja), cold-chain drugs.`,
    quickTips: ["Set min stock for top 20 drugs — stockouts lose customers forever","FIFO — oldest stock dispensed first, always","Write off expired stock immediately","Know margin by category: OTC vs Rx vs cosmetics"],
    keywords: ["expiry","FIFO","OTC","prescription","NAFDAC","PCN","dispensing","cold chain","fast-mover","stock count","drug margin","controlled","Artemether","Coartem"],
    commands: ["/product — each drug with NAFDAC in notes, set min stock","/stockin — deliveries with batch and expiry","/lowstock — every morning before opening","/expense — purchases/expired disposal/rent","/sale — daily dispensing revenue","/supplier — pharma distributor contacts"],
  },
  "Food & Beverage": {
    context: `You advise Nigerian food businesses: restaurant, fast food, buka, canteen, catering, bakery, drinks supplier.
METRICS: Food cost % (target 25-35% of revenue), daily revenue vs. target, avg transaction value, waste %.
PEAK: Lunch 12-2PM, dinner 6-9PM. Friday/Saturday highest. December/Easter/Sallah seasons critical.
COST: Ingredients (daily purchase), cooks/waiters, gas/fuel, packaging, delivery commission (Chowdeck 25%, Glovo 25%, Bolt Food 25%).
PAIN: Tomato/pepper price spikes, spoilage, power supply, staff discipline.
NICHES: Buka/mama put, QSR, premium dining, shawarma/grills, bakery/pastry, ghost kitchen (delivery-only), school/hospital canteen.`,
    quickTips: ["Food cost >40% = losing money even with full tables","Best-selling dish ≠ most profitable dish","Log spoilage daily — it's a real cost","Revenue per hour: push hard during 12-2PM and 6-9PM"],
    keywords: ["food cost","recipe","portion","perishable","daily purchase","covers","delivery commission","catering","menu","ingredient","mise en place","Chowdeck","Glovo","waste"],
    commands: ["/product — each menu item with recipe cost","/sale — by item or daily session total","/expense — daily ingredient purchase/gas/packaging","/staff — kitchen and front-of-house","/today — end-of-day revenue check","/analytics — weekly food cost % and top dishes"],
  },
  "Fashion": {
    context: `You advise Nigerian fashion businesses: boutique, designer, fabric seller, footwear, accessories, tailor.
HIGH SEASONS: December (Christmas/NY), April (Easter), July-August (Sallah), September (back-to-school), October-November (wedding season).
METRICS: Sell-through rate (%stock sold/season), average selling price, markdown %, return rate, custom order deposit conversion.
COST: COGS (fabric/imported goods), tailoring labour, Instagram ads/influencer fees, logistics.
SLOW MOVERS: Wrong size distributions, out-of-season styles. Mark down aggressively after 60 days.
NICHES: Ankara/Adire/Aso-oke designer, ready-to-wear fast fashion, corporate wear, children's, luxury, bridal, diaspora export.`,
    quickTips: ["Sell-through: unsold after 60 days = mark it down","Know which sizes/colours sell fastest — reorder those","Custom orders need upfront deposit tracking","December = up to 40% of annual revenue — stock up October"],
    keywords: ["sell-through","aso-ebi","bespoke","seasonal","markdown","Ankara","ready-to-wear","fabric","size run","boutique","custom order","fashion week","consignment","Aso-oke"],
    commands: ["/product — each item with colour/size/cost","/sale — record with size in notes for reorder intel","/lowstock — flag bestseller sizes before high season","/expense — fabric/tailoring/Instagram ads","/revenue — track by season","/analytics — sell-through and margin"],
  },
  "Construction": {
    context: `You advise Nigerian construction contractors, developers, and building materials suppliers.
OPERATIONS: Project-based. Quote → milestone payments (foundation, lintel, roof, finishing) → final payment + retention (5-10%).
COST: Materials (cement ₦7,000-9,000/bag, iron rods, blocks ₦800-1,200 each, sand, granite, tiles), direct labour (artisans ₦5,000-15,000/day), equipment hire.
KEY RISK: Materials inflation (cement doubled in 2 years), payment delays, site theft.
METRICS: Project margin %, cost overrun %, collection days, retention outstanding.
NICHES: Residential, commercial, roads/civil works, renovation/fit-out, real estate development, building materials supply.`,
    quickTips: ["Track each project separately — cost overruns hide in totals","Cement prices change weekly — re-cost active BOQs","Stage payment schedule must be in every contract","Weekly site stock count (cement/rods) — theft is common"],
    keywords: ["BOQ","stage payment","retention","artisan","subcontractor","site","cement","iron rod","lintel","foundation","contract sum","variation","builder","block","granite"],
    commands: ["/product — materials (cement/rods/blocks) to track usage","/sale — stage payment received per project","/expense — materials/labour/equipment per project","/order — project tracking with milestones","/supplier — material suppliers with current pricing","/analytics — cost vs. revenue by project"],
  },
  "Shipping": {
    context: `You advise Nigerian shipping agents, freight forwarders, and customs clearing agents.
KEY DOCS: Bill of Lading, Form M, NCS Single Window, HS codes, duty calculation, SON/NAFDAC pre-clearance.
REVENUE: Clearing fees, freight charges, demurrage management fee, documentation, duty markup.
COST: Customs duties (client's), terminal charges (APMT/ENL/Grimaldi), trucking, shipping line charges, agent fees.
NICHES: General cargo, perishables, Tokunbo vehicles, dangerous goods, project cargo, air freight, trade finance.
PAIN: Demurrage (₦300K-1M/day for containers), NPA/APMT system downtime, forex for duty payment.`,
    quickTips: ["Track each shipment profitability separately","Alert clients 2 days before free days expire — demurrage is brutal","Never quote flat rate without checking current terminal charges","Track NCS duty paid vs. your fee separately for true margin"],
    keywords: ["bill of lading","clearing","customs","NCS","demurrage","freight","Form M","HS code","terminal","Apapa","Tin Can","Onne","duty","levy","pre-clearance","shipping line"],
    commands: ["/sale — clearing fee per job (use shipment ref)","/expense — duty/terminal/trucking per shipment","/order — job order per shipment to track status","/supplier — shipping lines and terminal operators","/today — receivables and outstanding jobs","/profit — per-job margin"],
  },
  "Warehousing": {
    context: `You advise Nigerian warehousing and 3PL operators.
REVENUE: Storage fees (per pallet/sqm/month), handling fees (in/out), pick-and-pack, distribution.
METRICS: Occupancy rate (target 70-90%), stock accuracy, order pick accuracy, throughput (pallets/day).
COST: Rent (dominant), labour (forklift/storekeeper), utilities, racking, equipment.
NICHES: FMCG warehousing (Unilever/Dangote), cold store, pharmaceutical, e-commerce fulfillment, bonded warehouse.`,
    quickTips: ["Occupancy <70% = underutilised; >95% = overflow risk","Physical vs. system count should match within 0.5%","Bill inbound + outbound + storage separately","Track labour productivity per worker per day"],
    keywords: ["pallet","racking","SKU","pick-and-pack","3PL","occupancy","throughput","cold store","bonded","FMCG","cross-docking","stock accuracy","fulfillment"],
    commands: ["/product — each client's SKUs","/stockin — inbound goods with client name","/stockout — dispatched goods","/expense — rent/utilities/labour","/sale — monthly storage and handling fees","/inventory — system vs. physical count"],
  },
  "Energy": {
    context: `You advise Nigerian energy businesses: fuel station, LPG dealer, solar installer, generator rental.
METRICS: Daily throughput (litres/kg sold), margin/litre (PMS: ₦15-30), LPG margin/kg, generator rental revenue.
COST: Product purchase, staff, maintenance, security, losses/diversion.
NICHES: NNPC/Total/Ardova dealer, LPG mini-depot, off-grid solar (hybrid/SHS), commercial diesel supply, generator hire/maintenance.
PAIN: NNPCL pricing volatility, diversion, measurement fraud, fuel scarcity, solar customer financing.`,
    quickTips: ["Track litres sold per day — drop = diversion or supply issue","PMS margin × daily litres = gross profit (target ₦15-25/litre)","LPG margin better than PMS — know your margin/kg","Generator rental: reserve 15% of revenue for maintenance"],
    keywords: ["PMS","AGO","DPK","LPG","litres","throughput","tank","depot","dispenser","solar","inverter","generator","diesel","NNPCL","deregulation","margin per litre"],
    commands: ["/product — each fuel type with purchase cost","/sale — daily sales by product with volume","/stockin — tanker deliveries with quantity/price","/expense — pump maintenance/staff/security","/lowstock — minimum tank level alerts","/analytics — daily throughput and margin"],
  },
  "Healthcare": {
    context: `You advise Nigerian healthcare businesses: clinic, diagnostic centre, specialist practice, laboratory.
METRICS: Patients/day, revenue/patient, HMO collection days (often 60-90 days — cash flow killer), HMO outstanding claims, diagnostic utilisation.
COST: Staff salaries (40-60%), consumables (gloves/syringes/reagents), drugs, equipment maintenance, generator.
HMO RISK: HMOs pay slow. Revenue on paper ≠ cash in hand. Track separately.
NICHES: GP clinic, specialist (GYN/paeds/urology), diagnostics (ultrasound/X-ray/lab), eye/dental, rehabilitation, telemedicine, NHIA/BHCPF facility.`,
    quickTips: ["Know HMO receivables vs. private cash separately — HMO can look good but drain cash","Private pays 3-5x more per visit than HMO","Consumable stockouts stop procedures — set aggressive minimums","Salaries at 40-60% of revenue is normal — beyond 65% is danger zone"],
    keywords: ["consultation","HMO","NHIA","patient","diagnostic","procedure","OPD","lab","reagent","consumable","claims","co-payment","capitation","referral","BHCPF","NHIS"],
    commands: ["/sale — consultations/procedures/lab tests by service","/product — services with cost (consultation/X-ray/test)","/expense — consumables/drugs/staff costs","/supplier — medical equipment and consumable suppliers","/lowstock — critical consumables and drugs","/analytics — daily patient revenue vs. target"],
  },
  "Beauty": {
    context: `You advise Nigerian beauty businesses: hair salon, barbershop, spa, skincare brand, makeup artist.
METRICS: Clients/day, avg spend/client, station/chair utilisation, retail product margin, repeat rate.
PEAK: December, Easter, Sallah, wedding season (Oct-Nov, April). Build stock and book appointments in advance.
COST: Products/materials (hair extensions, relaxers, dyes, skincare), staff salary + commission, rent, utilities.
NICHES: Natural hair, premium spa, barbershop chain, skincare formulator, lash/brow specialist, bridal, beauty school, beauty supply retail.`,
    quickTips: ["Idle station = lost revenue — track utilisation","Retention: target >60% of clients return within 4 weeks","Products unsold 30 days need a promotion — they expire","December = potential 40-60% of annual revenue — plan for it"],
    keywords: ["appointment","walk-in","chair","station","client retention","hair extensions","relaxer","weave","natural hair","lash","nail","spa","skincare","makeup","commission","wig"],
    commands: ["/sale — each service with client name for retention tracking","/product — services and retail products separately","/expense — products used/staff wages/rent/utilities","/staff — stylists with commission structure in notes","/revenue — track by peak season","/analytics — daily revenue and top services"],
  },
  "Education": {
    context: `You advise Nigerian education businesses: private school, tutoring centre, vocational training, e-learning.
REVENUE: School fees (termly, lumpy), registration, PTA levies, exam fees, uniform/book sales, holiday classes.
CASH FLOW: Heavy income start of term → sparse mid-term. Plan for the mid-term dip.
METRICS: Enrolment, fee collection rate (target >85% of billing), cost/student, salary-to-revenue ratio (keep <50%).
COST: Teacher salaries (40-60%), rent, utilities, learning materials, WAEC/NECO fees.
NICHES: Nursery/primary/secondary, international curriculum, vocational (welding/catering/ICT/fashion), university tutorial, JAMB/WAEC/IELTS prep, coding school, online tutoring.`,
    quickTips: ["Fee collection rate >85% is excellent — below 70% is a cash crisis","Salary-to-revenue >50% = you'll run out of cash","Holiday classes are high-margin add-ons — promote them","3 terms of declining enrolment needs urgent action"],
    keywords: ["enrolment","school fees","term","pupil","student","teacher","curriculum","WAEC","JAMB","lesson","tutorial","vocational","registration","PTA","uniform","NECO"],
    commands: ["/product — fee types (tuition/registration/PTA) as products","/sale — each student's payment with student name","/expense — salaries/utilities/materials/maintenance","/staff — teachers and non-teaching staff","/payroll — monthly salary payments","/analytics — term revenue, collection rate, cost/student"],
  },
  "Hospitality": {
    context: `You advise Nigerian hospitality businesses: hotel, guesthouse, short-let, event centre, bar, travel agency.
METRICS: Occupancy rate (% rooms occupied nightly), ADR (average daily rate), RevPAR = Occupancy × ADR, F&B revenue/cover.
PEAK: Q4 (Oct-Dec) highest. Christmas/Detty December critical. New Year, public holidays, corporate bookings.
COST: Staff (large), generator fuel (20-30% of costs in Nigeria — track daily), food/beverage, OTA commissions (Booking.com 15-25%, Airbnb 15-17%).
NICHES: Budget hotel, boutique hotel, short-let (Airbnb/Booking.com), event venue, bar/lounge, travel agency.`,
    quickTips: ["Occupancy × ADR = Revenue — both must be high","Generator fuel can be 20-30% of total costs — log it daily","Corporate accounts > walk-in guests — more stable","OTA commissions eat margin — track net revenue not gross"],
    keywords: ["occupancy","ADR","RevPAR","check-in","checkout","room nights","event","F&B","short-let","Airbnb","Booking.com","corporate","OTA","MICE","room type"],
    commands: ["/product — room types and event packages","/sale — bookings and event hire daily","/expense — utilities/F&B/staff/maintenance","/staff — front desk/housekeeping/F&B","/today — daily occupancy revenue vs. target","/analytics — weekly RevPAR and cost ratios"],
  },
  "ICT": {
    context: `You advise Nigerian ICT/technology businesses: software, IT services, web agency, digital marketing, repairs, CCTV, tech training.
REVENUE: Project fees, monthly retainers (MRR), product sales (hardware/licences), training fees.
METRICS: MRR, project utilisation (billable hours ÷ total hours), avg project size, retainer churn rate.
PAYMENT REALITY: Nigerian clients delay project milestone payment. Track receivables tightly — invoice fast.
NICHES: Mobile app development, fintech/payment integration, e-commerce, ERP/accounting software, managed IT, digital marketing (Meta/Google Ads), CCTV/networking, blockchain, tech training.`,
    quickTips: ["MRR = predictable cash; project-only = feast-or-famine","Track hours/project — burning more than quoted = losing money","Collect 40-50% upfront — this is industry standard and fair","Audit cloud bills monthly — AWS/DigitalOcean costs creep"],
    keywords: ["MRR","retainer","project","SaaS","software","development","digital marketing","IT support","managed services","hosting","app","website","SLA","billable hours","cloud","fintech"],
    commands: ["/product — service types with cost","/sale — project payments and monthly retainers","/expense — cloud/hosting/software licences/contractor","/staff — developers/designers/sales","/order — project milestones and deliverables","/analytics — MRR trend and margin/service type"],
  },
  "Auto & Transport": {
    context: `You advise Nigerian auto businesses: car dealer, vehicle hire, bus/taxi operator, mechanic, auto-parts, driving school.
METRICS: Vehicles sold/month, avg repair ticket, mechanic bay utilisation, fleet utilisation (hire), parts turnover.
COST: Vehicle purchase cost, spare parts, mechanic labour (commission/piece-rate common), workshop rent, fuel.
KEY: Days-in-stock (vehicle unsold 90+ days = reduce price), parts tracking (theft by mechanics common), repair job profitability.
NICHES: Tokunbo/imported car dealer, Nigerian-used dealer, luxury car hire, auto workshop, tyre/battery dealer, truck/bus operator, driving school, panel and paint.`,
    quickTips: ["Days-in-stock >90 days = reduce price immediately","Track parts used per repair job — parts theft is very common","Labour charge separate from parts — know each margin","Check Jiji/Cars45 weekly for market price benchmarks"],
    keywords: ["Tokunbo","VIN","car dealer","spare parts","mechanic","service","workshop","fleet","hire","taxi","tyre","battery","panel","paint","driving school","importation","FRSC"],
    commands: ["/product — each vehicle (VIN in notes) or parts category","/sale — each vehicle sale or repair job","/expense — vehicle purchase/parts/mechanic pay/rent","/stockin — parts inventory restocking","/supplier — parts suppliers and importers","/analytics — days-in-stock, monthly sales vs. inventory"],
  },
  "Finance": {
    context: `You advise Nigerian financial services: microfinance, cooperative, POS agent, BDC, fintech, remittance.
METRICS: Loan portfolio size, NPL rate (target <5%), daily POS volume, avg transaction value, FX spread.
RISK: Credit risk (NPL), liquidity risk, CBN regulatory risk (for MFBs).
NICHES: Microfinance bank, cooperative society, thrift/ajo, POS agent (OPay/Moniepoint/PalmPay), BDC, remittance (Western Union/MoneyGram), BNPL fintech.
COMPLIANCE: CBN licensing, SCUML for BDCs, cooperative registration with state government, KYC/AML requirements.`,
    quickTips: ["NPL >10% = serious crisis — know every overdue loan by name and amount","POS float: too much = theft risk; too little = missed transactions","Check parallel FX rate vs. official every morning before opening","Cooperative income is predictable — model your cash flow monthly"],
    keywords: ["loan","NPL","portfolio","interest","POS","float","FX","bureau de change","remittance","cooperative","thrift","ajo","microfinance","CBN","KYC","AML","capitation"],
    commands: ["/product — loan products or service types","/sale — interest received/fees/FX spread per deal","/expense — operating costs/bad debt provision","/supplier — funding sources (banks/investors/deposits)","/analytics — portfolio size, daily volume, NPL estimate","/staff — loan officers/tellers/agents"],
  },
  "Agro-Processing": {
    context: `You advise Nigerian agro-processing businesses: cassava (garri/starch/flour), palm oil, groundnut oil, rice milling, cocoa, soya.
METRICS: Conversion ratio (kg raw → kg output), processing cost/kg, waste/by-product utilisation, capacity utilisation %.
COST: Raw materials (50-70%), energy (diesel for mills), direct labour, packaging, transport.
BY-PRODUCTS: Palm kernel from palm oil, soya cake from extraction, rice bran, cassava peel (animal feed) — track all revenue.
NICHES: Village/community tolling mill, branded consumer goods, export-grade processing (EU/US certified), animal feed manufacturing.`,
    quickTips: ["Conversion ratio is your core efficiency — poor ratio = wasted raw material","By-products (palm kernel/cassava peel) are revenue most processors ignore","Energy cost/kg is your efficiency indicator","Raw material price spikes can wipe margin — track purchase price vs. product price weekly"],
    keywords: ["cassava","garri","palm oil","kernel","milling","processing","conversion ratio","tolling","packaging","starch","by-product","capacity","throughput","grinding","flour","soya","groundnut"],
    commands: ["/product — output products with full production unit cost","/stockin — processed output after each run","/expense — raw materials/energy/labour per run","/sale — sales to distributors/direct customers","/supplier — raw material farmers/aggregators","/analytics — weekly conversion efficiency and margin"],
  },
  "Printing": {
    context: `You advise Nigerian printing businesses: digital/offset printing, signage, flexographic, packaging, screen printing.
OPERATIONS: Quote → receive artwork → print → deliver. Rush jobs = premium price (50-100% surcharge standard).
METRICS: Machine uptime (printing hours ÷ available hours), avg job value, jobs/day throughput, waste rate (target <5%).
COST: Paper/ink/toner/vinyl/canvas, lamination/binding/finishing, machine maintenance, electricity/generator, delivery.
NICHES: Digital print shop, offset lithography, flexographic packaging, outdoor advertising (billboards), event branding, promotional merchandise, corporate stationery, political campaign printing.`,
    quickTips: ["Track revenue per machine per month — idle equipment destroys ROI","Paper and ink wastage >5% = money going in bin","Rush jobs should cost 50-100% more — price them that way","Quote: material + labour + machine time + delivery + margin"],
    keywords: ["print","offset","digital","flexo","flyer","banner","signage","vinyl","toner","ink","paper","gsm","lamination","binding","artwork","large format","billboard","merchandise"],
    commands: ["/product — print types with material cost","/sale — each job with customer name and job ref","/expense — paper/ink/vinyl/machine maintenance/delivery","/supplier — paper merchants and ink suppliers","/order — track print jobs from order to delivery","/analytics — revenue per job type, monthly throughput"],
  },
  "Security": {
    context: `You advise Nigerian security companies: manned guarding, electronic security (CCTV/access control), alarm systems.
REVENUE: Monthly guarding contracts (per post/month), one-time installation fees, monitoring fees (MRR model), alarm response fees.
METRICS: Active contracts, MRR, guard-to-supervisor ratio (max 15:1), client retention rate, guard attrition rate.
COST: Guard salaries and allowances (70-80% of revenue), uniform/equipment, transport, NSCDC-mandated training, insurance.
NICHES: Bank/FI guarding, estate security, retail/shopping mall, industrial site, VIP/executive protection, maritime security, electronic surveillance, cash-in-transit.`,
    quickTips: ["Guard salaries at 70%+ of revenue = danger zone — negotiate better contracts","Losing one large contract can be catastrophic — diversify client base","NSCDC license renewal + guard training = non-negotiable cost","3-month client payment history before extending any credit"],
    keywords: ["guard","post","contract","site","CCTV","access control","alarm","monitoring","patrol","NSCDC","VIP","cash-in-transit","maritime","residential","attrition","MRR","armed escort"],
    commands: ["/product — contract types (guarding post/CCTV/monitoring)","/sale — monthly contract billing per client","/expense — salaries/uniforms/transport/training","/staff — guards/supervisors/control room operators","/payroll — monthly salary by post/site","/analytics — MRR, salary ratio, active contracts"],
  },
  "Crypto & Gift Cards": {
    context: `You advise Nigerian crypto and gift card trading businesses — platforms or individual operators who buy and sell digital assets and gift cards for Naira. Your model reference is Jeroid (jeroid.co), a Lagos-based ISO-certified crypto and gift card platform trusted by 500,000+ users since 2018.

BUSINESS MODEL — HOW JEROID-TYPE OPERATORS MAKE MONEY:
Revenue comes from the spread between the buy rate (what you pay the customer) and the sell rate (what you charge them), plus the difference between what you buy gift cards at vs. their Naira redemption value. The business has three product lines: crypto trading, gift card redemption, and utility bill payments. OTC/E-Funds desks handle large volume trades privately.

PRODUCT LINES AND HOW TO TRACK EACH:
1. CRYPTO TRADING (buy and sell)
   - Assets: BTC, ETH, USDT (TRC20 and ERC20), USDT (BEP20), SOL, BNB, USDC
   - Buy rate: the Naira rate at which you buy crypto from a customer
   - Sell rate: the Naira rate at which you sell crypto to a customer
   - Spread = sell rate minus buy rate = gross profit per unit traded
   - Current Jeroid USDT buy rate: ~₦1,410/USDT (use as market reference)
   - Payout target: under 15 minutes from confirmation to Naira credit
   - Revenue per trade = spread × volume. Track every trade as a sale in ShopBoss
   
2. GIFT CARD REDEMPTION
   - 100+ brands: Amazon, iTunes/Apple, Steam, Google Play, Visa, Mastercard, Netflix, Spotify, PlayStation, Xbox, Roblox, eBay, Walmart, Nike, Adidas, Razer Gold, American Express
   - Rate varies by brand, card type (physical/e-code), country of issue (US > UK > AU > EU), and denomination
   - Key metric: redemption rate (₦ per $1 of card face value). Amazon US = highest rate typically
   - Cards are valued at a discount to face value — your margin is the difference between what you pay the customer and what you recover from the card
   - Track each brand as a separate product: "Amazon Gift Card", "iTunes Gift Card", etc.
   - Set cost price = what you pay per $1 of card, sell price = what you actually recover or resell per $1
   - Expired, used, or invalid cards = 100% loss. Verification before payment is critical

3. UTILITY BILLS (airtime, data, electricity, DSTV, etc.)
   - Revenue model: you purchase at a discounted rate from aggregators (e.g. 3-5% below face value) and sell at face value
   - Volume business: thin margin, high frequency
   - Track: MTN airtime, Glo, Airtel, 9mobile, IKEDC/EKEDC electricity, DSTV, GOTV, Startimes, WAEC/NECO pins
   - Set up each biller as a product with your cost vs. customer price

4. E-FUNDS / OTC DESK
   - Large trades handled privately via agent or chat
   - Unlisted assets, non-standard trade sizes, corporate clients
   - Pricing is negotiated not posted — track as high-value individual sales with custom margin

OPERATIONS — THE JEROID MODEL:
- Centralised model (not peer-to-peer): the platform holds inventory and bears the price risk
- Customer sends crypto → platform verifies receipt → pays Naira. Platform sells its own crypto to customers
- Speed is the product: 15-minute payouts are the competitive promise
- Float management: must have sufficient Naira float to pay customers and sufficient crypto inventory to sell to buyers
- Coincover insurance: Jeroid uses Coincover to insure crypto assets against theft and loss
- ISO 9001:2015 certified: quality management standard — relevant for larger operators building trust
- NDPR compliance: Nigeria Data Protection Regulation applies to any platform storing user data

KEY METRICS (track these in ShopBoss):
- Daily crypto volume (₦ value traded buy + sell combined)
- Daily gift card volume (₦ value of cards redeemed)
- Average spread per asset class
- Payout speed (target under 15 minutes)
- Decline rate (% of cards rejected as invalid — should be under 5%)
- Trade count per day
- Naira float available vs. crypto inventory value
- Customer disputes / failed payouts

RISK FACTORS (Jeroid-style centralised platform):
- CRYPTO PRICE VOLATILITY: If you hold BTC/ETH inventory, price drops = balance sheet loss. USDT eliminates this
- GIFT CARD FRAUD: Customers attempt to sell already-used, stolen, or counterfeit cards. Verification via card portal before payment is mandatory
- PAYMENT FRAUD: Fake Naira transfer confirmations. Verify before releasing crypto
- REGULATORY RISK: SEC Nigeria and CBN guidelines on crypto. Jeroid operates compliantly with NDPR and ISO certification
- FLOAT SHORTAGE: Running out of Naira float during high-volume periods means missed trades and reputation damage
- CHARGEBACK (bank reversals): Someone pays Naira, you release crypto, they reverse the bank transfer. Confirm credit in your bank — not just a screenshot

HOW TO TRACK THIS BUSINESS IN SHOPBOSS:
PRODUCTS (set up one per asset/card type):
  • "USDT/TRC20 Buy" — cost = your Naira payout to customer, sell price = what you sell USDT for
  • "BTC Buy" — track by trade
  • "Amazon Gift Card" — sell price = ₦ per $1 recovered, cost = ₦ per $1 paid to customer
  • "MTN Airtime" — sell price = face value, cost = your discounted purchase price

SALES: each completed trade = one sale entry (product, quantity, price, customer)
EXPENSES: bank transfer fees, agent salaries, customer support, tech/app costs, compliance costs, withdrawal fees
INVENTORY: your current Naira float + crypto holdings value
ANALYTICS: spread per asset, daily volume, gift card decline rate, revenue by product line

COMPETITIVE INTELLIGENCE (Jeroid's market position):
- 500,000+ registered users — significant Nigerian market share
- Trusted since 2018 — 8 years of track record
- First Nigerian crypto company with ISO 9001:2015 certification
- Brand ambassadors: Zlatan Ibile, Pocolee, Caramel Plugg — youth/entertainment demographics
- Featured in: TechCabal, BusinessDay, Nairametrics, Bitcoin.com, The Guardian Nigeria
- Contact: 194 Herbert Macaulay Way, Yaba, Lagos · 08124877671 · info@jeroid.ng · @jeroidng
- Apps: iOS and Android available at jeroid.co`,

    quickTips: [
      "Verify every gift card via the brand's redemption portal before releasing Naira — declined cards are 100% loss",
      "USDT/TRC20 is your safest inventory — no price volatility, low transfer fees (~1 USDT)",
      "Track spread per asset class separately — Amazon cards and BTC have very different margins",
      "Naira float shortage during high volume kills your reputation faster than any other problem — monitor daily",
      "Payout speed is the product: if competitors pay in 10 minutes and you take 40, you lose the customer",
      "Record every trade as a sale immediately — reconcile crypto wallet balance with ShopBoss inventory weekly",
    ],

    keywords: [
      "buy rate","sell rate","spread","USDT","BTC","ETH","SOL","BNB","USDC","TRC20","ERC20","BEP20",
      "gift card","Amazon","iTunes","Steam","Google Play","Netflix","Spotify","PlayStation","Xbox",
      "Roblox","eBay","Walmart","Nike","Adidas","Visa gift card","Mastercard gift card","Razer Gold",
      "redemption rate","e-code","physical card","denomination","decline","invalid card","face value",
      "airtime","data","electricity","DSTV","GOTV","utility bills","IKEDC","EKEDC","WAEC pin",
      "OTC","E-Funds","trade chat","unlisted asset","OTC desk","large trade","agent",
      "payout","15 minutes","float","Naira float","crypto inventory","Coincover","ISO certified",
      "NDPR","SEC Nigeria","CBN","chargeback","reversal","verified","bank transfer",
      "Jeroid","jeroid.co","sweetest rates","trade without borders","digital assets",
      "portfolio","wallet","swap","HODL","market rate","indicative rate","live rate",
    ],

    commands: [
      "/product — add each asset and gift card brand (USDT, BTC, Amazon, iTunes, etc.) as separate products",
      "/sale — record each completed trade: qty=amount traded, price=your sell/redemption rate, cost=what you paid customer",
      "/stockin — add crypto received from customers to your inventory",
      "/stockout — deduct crypto sold to customers or withdrawn",
      "/expense — bank fees, agent salaries, tech costs, compliance, withdrawal fees",
      "/revenue — total Naira received today by product line (crypto vs. gift cards vs. bills)",
      "/profit — net margin after payouts to customers and operating costs",
      "/inventory — check current Naira float and crypto holdings",
      "/analytics — spread per asset, daily volume, most profitable product line",
      "/ask — 'Which asset has the best margin this week?' or 'Is my gift card decline rate too high?'",
    ],
  },

  "Export/Import": {
    context: `You advise Nigerian export/import businesses.
Import: Electronics (Alaba), vehicles (Tokunbo), textiles, machinery, food, chemicals.
Export: Sesame, cashew, cocoa, leather, rubber, ginger, shea butter, hibiscus, garments (AGOA), leather.
KEY DOCS: Form M, HS codes, NAFDAC import permit, NESREA, NEPC registration (exporters), Phytosanitary cert, Certificate of Origin.
KEY COSTS: Duty/levies (5-35% CIF), clearing fees, freight, insurance, forex loss (Naira devaluation risk on invoice date vs. payment date).
NICHES: Commodity export, non-oil export (garments/leather/handicrafts), import facilitation, trade finance, e-commerce import (Alibaba reselling).`,
    quickTips: ["Landed cost = CIF + duty + clearing + local freight — know this before pricing","Naira devaluation between order and payment can wipe margin — hedge if possible","NEPC registration unlocks export incentives — mandatory for serious exporters","Track each shipment profitability independently"],
    keywords: ["Form M","HS code","CIF","FOB","landed cost","duty","NAFDAC","NEPC","NESREA","phytosanitary","Tokunbo","sesame","cashew","cocoa","shea","commodity","clearing","freight","forex"],
    commands: ["/product — commodity/import item with cost","/sale — sales per batch/shipment","/expense — duty/clearing/freight/insurance per shipment","/order — import-export job tracking","/supplier — overseas suppliers and local buyers","/analytics — per-shipment profitability"],
  },
};

const DEFAULT_PROFILE = {
  context: "You advise Nigerian SME business owners. Focus on: daily revenue, cost management, profit margin, stock levels, cash flow. Be direct and specific.",
  quickTips: ["Track every sale and expense daily","Know your gross margin","Monitor cash flow weekly","Set minimum stock levels"],
  keywords: ["revenue","profit","margin","stock","expense","cash flow"],
  commands: ["/sale","/expense","/inventory","/dashboard","/analytics"],
};

function buildSystemPrompt(industry) {
  const p = INDUSTRY_PROFILES[industry] || DEFAULT_PROFILE;
  return `You are ShopBoss AI, an expert business advisor for Nigerian SME owners.

${p.context}

RULES:
- Use ONLY the real business data provided — NEVER invent or estimate figures
- If data is zero or missing, say so explicitly
- Format ALL currency as ₦ with commas (₦12,500)
- Be direct and actionable — give specific numbers and clear next steps
- Keep responses under 280 words (Telegram-friendly)
- Use bullets for lists
- When you spot a problem, name it and say exactly what to do
${p.keywords ? `\nINDUSTRY TERMS: ${p.keywords.join(", ")}` : ""}`;
}

async function askAI(businessId, userQuestion, industry) {
  const client = getClient();
  const { Analytics } = require("../db/database");
  let data;
  try { data = Analytics.forAI(businessId); }
  catch (e) { data = { error: "Could not load data: " + e.message }; }
  const resp = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 700,
    system: buildSystemPrompt(industry),
    messages: [{ role: "user", content: `MY BUSINESS DATA:\n${JSON.stringify(data, null, 2)}\n\nQUESTION: ${userQuestion}` }],
  });
  return resp.content[0].text;
}

async function generateInsights(businessId, industry) {
  const client = getClient();
  const { Analytics } = require("../db/database");
  let data;
  try { data = Analytics.forAI(businessId); }
  catch (e) { return "⚠️ Could not load data: " + e.message; }
  const resp = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    system: buildSystemPrompt(industry),
    messages: [{
      role: "user",
      content: `MY BUSINESS DATA:\n${JSON.stringify(data, null, 2)}\n\nGenerate:\n1. 📊 Key numbers this month (from actual data)\n2. ⚠️ Top 2 concerns right now\n3. ✅ Top 3 specific actions this week\nUnder 250 words. ₦ format.`,
    }],
  });
  return resp.content[0].text;
}

function getIndustryWorkflow(industry) {
  const p = INDUSTRY_PROFILES[industry];
  if (!p) return { quickActions: ["💰 Record Sale","📦 Inventory","💸 Log Expense","📊 Dashboard"], insights: DEFAULT_PROFILE.quickTips, commands: DEFAULT_PROFILE.commands, keywords: [] };
  return { quickActions: (p.commands||[]).slice(0,4).map(c=>c.split(" — ")[0]), insights: p.quickTips||[], commands: p.commands||[], keywords: p.keywords||[] };
}

module.exports = { askAI, generateInsights, getIndustryWorkflow, INDUSTRY_PROFILES };
