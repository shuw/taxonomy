/**
 * The small jokes. None of them touch a number: they live in demo-mode symbols, empty states,
 * the odd aside on a line that is zero anyway, and the help dialog's last line.
 */

/** A stable small hash, so a joke lands on the same line every time rather than flickering. */
export function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Demo mode prices things in something. Each time it is turned on, the next something. */
export const DEMO_CURRENCIES: { symbol: string; name: string }[] = [
  { symbol: "Ⓣ", name: "Taxonomy units, exchange rate undisclosed" },
  { symbol: "₩", name: "won, give or take" },
  { symbol: "₪", name: "shekels, roughly" },
  { symbol: "🧅", name: "onions" },
  { symbol: "🦆", name: "rubber ducks" },
  { symbol: "🐚", name: "cowrie shells, the original" },
  { symbol: "🥔", name: "potatoes, unwashed" },
];
const CURRENCY_KEY = "taxonomy.demo.currency";
export function demoCurrency(): { symbol: string; name: string } {
  let i = 0;
  try { i = Number(localStorage.getItem(CURRENCY_KEY)) || 0; } catch {}
  return DEMO_CURRENCIES[((i % DEMO_CURRENCIES.length) + DEMO_CURRENCIES.length) % DEMO_CURRENCIES.length]!;
}
export function nextDemoCurrency(): void {
  try { localStorage.setItem(CURRENCY_KEY, String((Number(localStorage.getItem(CURRENCY_KEY)) || 0) + 1)); } catch {}
}

/** Now and then, a line that is zero gets a word of comfort. Never on a line with a value. */
const ZERO_ASIDES: Record<string, string[]> = {
  amt: ["Enjoy it.", "Nothing to see here, and that is the point.", "The alternative minimum tax took the year off."],
  amtCreditUsed: ["The bank is closed today.", "Nothing to draw on, nothing drawn."],
  stateTax: ["Washington sends its regards.", "The state took nothing. Frame this."],
  niit: ["Investment income too modest to notice. There are worse problems."],
  giving: ["Charity begins next year, apparently."],
  exerciseCost: ["Nothing bought. The wallet rests."],
  saleProceeds: ["Nothing sold. Diamond hands, or just hands."],
};
const ANY_ASIDE = ["Zero is a number too.", "A round number, at least.", "Some people would pay for a line like this."];
export function zeroAside(lineId: string, year: number, value: number): string | undefined {
  if (value !== 0) return undefined;
  const h = hashOf(`${lineId}:${year}`);
  if (h % 25 !== 0) return undefined;
  const pool = ZERO_ASIDES[lineId] ?? ANY_ASIDE;
  return pool[Math.floor(h / 25) % pool.length];
}

/** The equity section with nothing in it. Usually plain; sometimes not. */
const EMPTY_GRANTS = [
  "No grants yet. A blank slate; some people would pay for that.",
  "No grants yet. Nothing vests, nothing to exercise, nothing keeps you up at night.",
  "No grants yet. The AMT has never heard of you.",
];
export function emptyGrantsLine(plain: string): string {
  const roll = hashOf(String(Math.floor(Date.now() / 3_600_000)));
  return roll % 3 === 0 ? EMPTY_GRANTS[roll % EMPTY_GRANTS.length]! : plain;
}

/** One dated, sourced fact about the tax code per opening of the help dialog. */
export const TAX_TRIVIA: { text: string; source: string }[] = [
  { text: "The alternative minimum tax dates from 1969, after Treasury reported that 155 households with incomes over $200,000 had paid no federal income tax in 1966.", source: "Tax Reform Act of 1969; Treasury testimony, January 1969" },
  { text: "The first US income tax, in 1861, was 3% on income over $800 to pay for the Civil War. It was repealed in 1872.", source: "Revenue Act of 1861" },
  { text: "Form 1040 got its number in 1913 because that was the next form number in the Bureau of Internal Revenue's sequence.", source: "IRS history of Form 1040" },
  { text: "The 1913 income tax's top rate was 7%, on income over $500,000, about $16 million today.", source: "Revenue Act of 1913" },
  { text: "The $100,000 ISO rule has been $100,000 since 1981. It has never been indexed.", source: "IRC §422(d), Economic Recovery Tax Act of 1981" },
  { text: "Washington has no income tax because its 1932 ballot measure for one was struck down by the state supreme court in 1933.", source: "Culliton v. Chief of Tax Commission, 174 Wash. 363 (1933)" },
  { text: "Tax Day moved from March 15 to April 15 in 1955, giving the IRS more time to process a growing pile of returns.", source: "Internal Revenue Code of 1954" },
  { text: "Withholding from paychecks started in 1943; before that, people paid the year's tax in a lump sum the following March.", source: "Current Tax Payment Act of 1943" },
  { text: "The 1040EZ was retired in 2018 after 36 years. The full 1040 became a half-page with schedules instead.", source: "IRS, 2018 forms overhaul" },
  { text: "The top federal rate was 94% in 1944 and 1945, on income over $200,000.", source: "Individual Income Tax Act of 1944" },
];
let trivia = -1;
export function nextTrivia(): { text: string; source: string } {
  trivia = (trivia + 1 + (trivia < 0 ? hashOf(String(Date.now())) % TAX_TRIVIA.length : 0)) % TAX_TRIVIA.length;
  return TAX_TRIVIA[trivia]!;
}
