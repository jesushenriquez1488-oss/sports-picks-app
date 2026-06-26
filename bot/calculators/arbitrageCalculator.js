export function americanToImpliedProbability(odds) {
  const value = Number(odds);

  if (!Number.isFinite(value) || value === 0) {
    return null;
  }

  if (value > 0) {
    return 100 / (value + 100);
  }

  return Math.abs(value) / (Math.abs(value) + 100);
}

export function calculateTwoWayArbitrage(optionA, optionB, totalStake = 1000) {
  const probA = americanToImpliedProbability(optionA.odds);
  const probB = americanToImpliedProbability(optionB.odds);

  if (probA === null || probB === null) {
    return { isArbitrage: false };
  }

  const impliedTotal = probA + probB;

  if (impliedTotal >= 1) {
    return {
      isArbitrage: false,
      impliedTotal: round(impliedTotal * 100, 2)
    };
  }

  const stakeA = totalStake * (probA / impliedTotal);
  const stakeB = totalStake * (probB / impliedTotal);

  const payoutA = getAmericanPayout(optionA.odds, stakeA);
  const payoutB = getAmericanPayout(optionB.odds, stakeB);

  const guaranteedPayout = Math.min(payoutA, payoutB);
  const guaranteedProfit = guaranteedPayout - totalStake;
  const profitPercent = (guaranteedProfit / totalStake) * 100;

  return {
    isArbitrage: true,
    impliedTotal: round(impliedTotal * 100, 2),
    profitPercent: round(profitPercent, 2),
    stakeA: round(stakeA, 2),
    stakeB: round(stakeB, 2),
    totalStake,
    guaranteedProfit: round(guaranteedProfit, 2)
  };
}

function getAmericanPayout(odds, stake) {
  const value = Number(odds);

  if (value > 0) {
    return stake + (stake * value) / 100;
  }

  return stake + (stake * 100) / Math.abs(value);
}

function round(num, decimals = 2) {
  return Number(num.toFixed(decimals));
}
