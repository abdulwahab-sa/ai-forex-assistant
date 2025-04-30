def detect_bos(candles):
    bos = []
    for i in range(2, len(candles)):
        if candles[i]['high'] > candles[i - 1]['high'] and candles[i - 1]['high'] > candles[i - 2]['high']:
            bos.append({"type": "bullish_bos", "index": i, "price": candles[i]["high"]})
        elif candles[i]['low'] < candles[i - 1]['low'] and candles[i - 1]['low'] < candles[i - 2]['low']:
            bos.append({"type": "bearish_bos", "index": i, "price": candles[i]["low"]})
    return bos

def detect_order_blocks(candles):
    blocks = []
    for i in range(len(candles) - 1):
        current = candles[i]
        next_candle = candles[i + 1]
        if next_candle["close"] > next_candle["open"] and current["close"] < current["open"]:
            blocks.append({"type": "bullish_OB", "price": current["open"]})
        elif next_candle["close"] < next_candle["open"] and current["close"] > current["open"]:
            blocks.append({"type": "bearish_OB", "price": current["open"]})
    return blocks

def detect_fvg(candles):
    fvgs = []
    for i in range(2, len(candles)):
        if candles[i-2]["high"] < candles[i]["low"]:
            fvgs.append({
                "start": candles[i-2]["high"],
                "end": candles[i]["low"],
                "type": "bullish_fvg"
            })
        elif candles[i-2]["low"] > candles[i]["high"]:
            fvgs.append({
                "start": candles[i]["high"],
                "end": candles[i-2]["low"],
                "type": "bearish_fvg"
            })
    return fvgs

def detect_liquidity_zones(candles):
    highs = [c['high'] for c in candles]
    lows = [c['low'] for c in candles]
    return {
        "liquidity_high": max(highs),
        "liquidity_low": min(lows)
    }

def generate_smc_analysis(candles):
    return {
        "BOS": detect_bos(candles),
        "OrderBlocks": detect_order_blocks(candles),
        "FVG": detect_fvg(candles),
        "LiquidityZones": detect_liquidity_zones(candles)
    }
