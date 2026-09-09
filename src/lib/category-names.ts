// Curated display names for the Plaid PFC v2 taxonomy (src/lib/pfc.ts). Plaid
// ships a code and a prose description ("Purchases at coffee shops or
// cafes") but no short label - nothing in the taxonomy CSV says "Coffee
// Shops". These maps are that missing label, written by hand rather than
// derived from the code, because a mechanical transform (strip the primary
// prefix, title-case the rest) reads badly often enough to matter - see
// LOAN_DISBURSEMENTS_EWA, which title-cases to "Ewa".
//
// category-names.test.ts asserts exact key-set parity against the committed
// CSV in both directions, so a taxonomy refresh that adds or removes a code
// fails `bun test` instead of shipping a blank or orphaned label.

export const PRIMARY_NAMES: Record<string, string> = {
  INCOME: "Income",
  LOAN_DISBURSEMENTS: "Loan Disbursements",
  LOAN_PAYMENTS: "Loan Payments",
  TRANSFER_IN: "Transfers In",
  TRANSFER_OUT: "Transfers Out",
  BANK_FEES: "Bank Fees",
  ENTERTAINMENT: "Entertainment",
  FOOD_AND_DRINK: "Food & Drink",
  GENERAL_MERCHANDISE: "Shopping",
  HOME_IMPROVEMENT: "Home Improvement",
  MEDICAL: "Medical",
  PERSONAL_CARE: "Personal Care",
  GENERAL_SERVICES: "Services",
  GOVERNMENT_AND_NON_PROFIT: "Government & Non-Profit",
  TRANSPORTATION: "Transportation",
  TRAVEL: "Travel",
  RENT_AND_UTILITIES: "Rent & Utilities",
  OTHER: "Other",
}

export const DETAILED_NAMES: Record<string, string> = {
  // INCOME
  INCOME_CHILD_SUPPORT: "Child Support",
  INCOME_CONTRACTOR: "Contract Work",
  INCOME_DIVIDENDS: "Dividends",
  INCOME_GIG_ECONOMY: "Gig Economy",
  INCOME_INTEREST_EARNED: "Interest Earned",
  INCOME_LONG_TERM_DISABILITY: "Disability Income",
  INCOME_MILITARY: "Military Income",
  INCOME_RENTAL: "Rental Income",
  INCOME_RETIREMENT_PENSION: "Retirement & Pension",
  INCOME_SALARY: "Salary",
  INCOME_TAX_REFUND: "Tax Refund",
  INCOME_UNEMPLOYMENT: "Unemployment",
  INCOME_OTHER: "Other Income",

  // LOAN_DISBURSEMENTS
  LOAN_DISBURSEMENTS_AUTO: "Auto Loan",
  LOAN_DISBURSEMENTS_CASH_ADVANCES: "Cash Advance",
  LOAN_DISBURSEMENTS_EWA: "Earned Wage Access",
  LOAN_DISBURSEMENTS_MORTGAGE: "Mortgage Loan",
  LOAN_DISBURSEMENTS_PERSONAL: "Personal Loan",
  LOAN_DISBURSEMENTS_STUDENT: "Student Loan",
  LOAN_DISBURSEMENTS_OTHER_DISBURSEMENT: "Other Loan Disbursement",

  // LOAN_PAYMENTS
  LOAN_PAYMENTS_BNPL: "Buy Now, Pay Later",
  LOAN_PAYMENTS_CAR_PAYMENT: "Car Payment",
  LOAN_PAYMENTS_CASH_ADVANCES: "Cash Advance Payment",
  LOAN_PAYMENTS_CREDIT_CARD_PAYMENT: "Credit Card Payment",
  LOAN_PAYMENTS_EWA: "Earned Wage Access Payment",
  LOAN_PAYMENTS_MORTGAGE_PAYMENT: "Mortgage Payment",
  LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT: "Personal Loan Payment",
  LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT: "Student Loan Payment",
  LOAN_PAYMENTS_OTHER_PAYMENT: "Other Loan Payment",

  // TRANSFER_IN
  TRANSFER_IN_ACCOUNT_TRANSFER: "Account Transfer",
  TRANSFER_IN_DEPOSIT: "Deposit",
  TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS: "Investment & Retirement Transfer",
  TRANSFER_IN_SAVINGS: "Savings Transfer",
  TRANSFER_IN_TRANSFER_IN_FROM_APPS: "Transfer from App",
  TRANSFER_IN_WIRE: "Wire Transfer",
  TRANSFER_IN_OTHER_TRANSFER_IN: "Other Transfer In",

  // TRANSFER_OUT
  TRANSFER_OUT_ACCOUNT_TRANSFER: "Account Transfer",
  TRANSFER_OUT_CRYPTO: "Crypto Transfer",
  TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS: "Investment & Retirement Transfer",
  TRANSFER_OUT_SAVINGS: "Savings Transfer",
  TRANSFER_OUT_TRANSFER_OUT_FROM_APPS: "Transfer to App",
  TRANSFER_OUT_WIRE: "Wire Transfer",
  TRANSFER_OUT_WITHDRAWAL: "Withdrawal",
  TRANSFER_OUT_OTHER_TRANSFER_OUT: "Other Transfer Out",

  // BANK_FEES
  BANK_FEES_ATM_FEES: "ATM Fee",
  BANK_FEES_INSUFFICIENT_FUNDS: "Insufficient Funds Fee",
  BANK_FEES_INTEREST_CHARGE: "Interest Charge",
  BANK_FEES_FOREIGN_TRANSACTION_FEES: "Foreign Transaction Fee",
  BANK_FEES_OVERDRAFT_FEES: "Overdraft Fee",
  BANK_FEES_LATE_FEES: "Late Fee",
  BANK_FEES_CASH_ADVANCE: "Cash Advance Fee",
  BANK_FEES_OTHER_BANK_FEES: "Other Bank Fee",

  // ENTERTAINMENT
  ENTERTAINMENT_CASINOS_AND_GAMBLING: "Casinos & Gambling",
  ENTERTAINMENT_MUSIC_AND_AUDIO: "Music & Audio",
  ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS: "Events, Parks & Museums",
  ENTERTAINMENT_TV_AND_MOVIES: "TV & Movies",
  ENTERTAINMENT_VIDEO_GAMES: "Video Games",
  ENTERTAINMENT_OTHER_ENTERTAINMENT: "Other Entertainment",

  // FOOD_AND_DRINK
  FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR: "Beer, Wine & Liquor",
  FOOD_AND_DRINK_COFFEE: "Coffee Shops",
  FOOD_AND_DRINK_FAST_FOOD: "Fast Food",
  FOOD_AND_DRINK_GROCERIES: "Groceries",
  FOOD_AND_DRINK_RESTAURANT: "Restaurants & Bars",
  FOOD_AND_DRINK_VENDING_MACHINES: "Vending Machines",
  FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK: "Other Food & Drink",

  // GENERAL_MERCHANDISE
  GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS: "Bookstores & Newsstands",
  GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES: "Clothing & Accessories",
  GENERAL_MERCHANDISE_CONVENIENCE_STORES: "Convenience Stores",
  GENERAL_MERCHANDISE_DEPARTMENT_STORES: "Department Stores",
  GENERAL_MERCHANDISE_DISCOUNT_STORES: "Discount Stores",
  GENERAL_MERCHANDISE_ELECTRONICS: "Electronics",
  GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES: "Gifts & Novelties",
  GENERAL_MERCHANDISE_OFFICE_SUPPLIES: "Office Supplies",
  GENERAL_MERCHANDISE_ONLINE_MARKETPLACES: "Online Marketplaces",
  GENERAL_MERCHANDISE_PET_SUPPLIES: "Pet Supplies",
  GENERAL_MERCHANDISE_SPORTING_GOODS: "Sporting Goods",
  GENERAL_MERCHANDISE_SUPERSTORES: "Superstores",
  GENERAL_MERCHANDISE_TOBACCO_AND_VAPE: "Tobacco & Vape",
  GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE: "Other Shopping",

  // HOME_IMPROVEMENT
  HOME_IMPROVEMENT_FURNITURE: "Furniture",
  HOME_IMPROVEMENT_HARDWARE: "Hardware",
  HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE: "Repair & Maintenance",
  HOME_IMPROVEMENT_SECURITY: "Home Security",
  HOME_IMPROVEMENT_OTHER_HOME_IMPROVEMENT: "Other Home Improvement",

  // MEDICAL
  MEDICAL_DENTAL_CARE: "Dental Care",
  MEDICAL_EYE_CARE: "Eye Care",
  MEDICAL_NURSING_CARE: "Nursing Care",
  MEDICAL_PHARMACIES_AND_SUPPLEMENTS: "Pharmacies & Supplements",
  MEDICAL_PRIMARY_CARE: "Primary Care",
  MEDICAL_VETERINARY_SERVICES: "Veterinary Services",
  MEDICAL_OTHER_MEDICAL: "Other Medical",

  // PERSONAL_CARE
  PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS: "Gyms & Fitness",
  PERSONAL_CARE_HAIR_AND_BEAUTY: "Hair & Beauty",
  PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING: "Laundry & Dry Cleaning",
  PERSONAL_CARE_OTHER_PERSONAL_CARE: "Other Personal Care",

  // GENERAL_SERVICES
  GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING: "Accounting & Financial Planning",
  GENERAL_SERVICES_AUTOMOTIVE: "Automotive Services",
  GENERAL_SERVICES_CHILDCARE: "Childcare",
  GENERAL_SERVICES_CONSULTING_AND_LEGAL: "Consulting & Legal",
  GENERAL_SERVICES_EDUCATION: "Education",
  GENERAL_SERVICES_INSURANCE: "Insurance",
  GENERAL_SERVICES_POSTAGE_AND_SHIPPING: "Postage & Shipping",
  GENERAL_SERVICES_STORAGE: "Storage",
  GENERAL_SERVICES_OTHER_GENERAL_SERVICES: "Other Services",

  // GOVERNMENT_AND_NON_PROFIT
  GOVERNMENT_AND_NON_PROFIT_DONATIONS: "Donations",
  GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES: "Government Agencies",
  GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT: "Tax Payment",
  GOVERNMENT_AND_NON_PROFIT_OTHER_GOVERNMENT_AND_NON_PROFIT: "Other Government & Non-Profit",

  // TRANSPORTATION
  TRANSPORTATION_BIKES_AND_SCOOTERS: "Bikes & Scooters",
  TRANSPORTATION_GAS: "Gas & Fuel",
  TRANSPORTATION_PARKING: "Parking",
  TRANSPORTATION_PUBLIC_TRANSIT: "Public Transit",
  TRANSPORTATION_TAXIS_AND_RIDE_SHARES: "Taxis & Ride Shares",
  TRANSPORTATION_TOLLS: "Tolls",
  TRANSPORTATION_OTHER_TRANSPORTATION: "Other Transportation",

  // TRAVEL
  TRAVEL_FLIGHTS: "Flights",
  TRAVEL_LODGING: "Lodging",
  TRAVEL_RENTAL_CARS: "Rental Cars",
  TRAVEL_OTHER_TRAVEL: "Other Travel",

  // RENT_AND_UTILITIES
  RENT_AND_UTILITIES_GAS_AND_ELECTRICITY: "Gas & Electricity",
  RENT_AND_UTILITIES_INTERNET_AND_CABLE: "Internet & Cable",
  RENT_AND_UTILITIES_RENT: "Rent",
  RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT: "Sewage & Waste",
  RENT_AND_UTILITIES_TELEPHONE: "Telephone",
  RENT_AND_UTILITIES_WATER: "Water",
  RENT_AND_UTILITIES_OTHER_UTILITIES: "Other Utilities",

  // OTHER
  OTHER_OTHER: "Other",
}
