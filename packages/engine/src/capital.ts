/** Net capital gains and losses for a year, including carryforwards (Schedule D, simplified). */
export interface CapitalNetting {
  /** Long-term gain taxed at preferential rates. */
  preferentialGain: number;
  /** Short-term gain taxed as ordinary income. */
  ordinaryGain: number;
  /** Net loss deducted against ordinary income this year (up to $3,000; $1,500 MFS). */
  lossDeduction: number;
  carryOut: { shortTerm: number; longTerm: number };
}

export function netCapital(
  shortTermGains: number,
  longTermGains: number,
  carryIn: { shortTerm: number; longTerm: number },
  lossLimit = 3_000,
): CapitalNetting {
  const netST = shortTermGains - carryIn.shortTerm;
  const netLT = longTermGains - carryIn.longTerm;
  const total = netST + netLT;
  if (total >= 0) {
    // Losses on one side offset gains on the other; what survives keeps the gain side's character.
    if (netST >= 0 && netLT >= 0) return { preferentialGain: netLT, ordinaryGain: netST, lossDeduction: 0, carryOut: { shortTerm: 0, longTerm: 0 } };
    if (netLT > 0) return { preferentialGain: total, ordinaryGain: 0, lossDeduction: 0, carryOut: { shortTerm: 0, longTerm: 0 } };
    return { preferentialGain: 0, ordinaryGain: total, lossDeduction: 0, carryOut: { shortTerm: 0, longTerm: 0 } };
  }
  const deduction = Math.min(lossLimit, -total);
  // The deduction absorbs short-term loss first, then long-term.
  const stLoss = Math.max(0, -Math.min(0, netST + Math.max(0, netLT)));
  const ltLoss = -total - stLoss;
  const stUsed = Math.min(stLoss, deduction);
  const ltUsed = deduction - stUsed;
  return {
    preferentialGain: 0,
    ordinaryGain: 0,
    lossDeduction: deduction,
    carryOut: { shortTerm: stLoss - stUsed, longTerm: ltLoss - ltUsed },
  };
}
