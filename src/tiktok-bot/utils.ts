export function shouldTakeAction(percentage: number): boolean {
  return Math.random() * 100 < percentage;
}

export function randomWaitTime(): number {
  return Math.floor(Math.random() * 11001);
}
