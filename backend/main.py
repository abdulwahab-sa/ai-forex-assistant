from fastapi import FastAPI 
from dotenv import load_dotenv
load_dotenv()
from tools.forex_data import get_forex_data
from tools.smc_analyzer import generate_smc_analysis

app = FastAPI()


@app.get("/")
def read_root():
    return {"message": "FastAPI is working" }


@app.get("/get-smc-signal")
def get_smc_signal(pair: str = "EURUSD"):
    timeframes = {
        "5M": "5min",
        "15M": "15min",
        "1H": "1hour"
    }

    signal_structure = {}

    for tf_label, interval in timeframes.items():
        candles = get_forex_data(pair=pair, interval=interval)
        structure = generate_smc_analysis(candles)
        signal_structure[tf_label] = structure

    return {
        "pair": pair,
        "signal_structure": signal_structure
    }