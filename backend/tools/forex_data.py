import requests
from datetime import datetime, timedelta
import pytz
import os

api_key = os.getenv("RAPIDAPI_KEY")

def get_forex_data(pair="EURUSD", interval="5min" ):
    # Get current time in UTC using pytz
    # utc_zone = pytz.UTC
    # to_time = datetime.now(utc_zone)
    
    to_time = datetime.now(pytz.UTC)
    
    # Format the current date to fetch data for today
    formatted_date = to_time.strftime("%Y-%m-%d")
    # Define API endpoint and headers
    url = "https://real-time-quotes1.p.rapidapi.com/api/v1/historical/forex"
    headers = {
        "x-rapidapi-key": api_key,
        "x-rapidapi-host": "real-time-quotes1.p.rapidapi.com"
    }
    
    # Create query string with date range and pair details
    querystring = {
        "interval": interval,  # Interval format like "1min", "5min"
        "source": pair[:3],  # Base currency (e.g., "EUR")
        "target": pair[3:],  # Target currency (e.g., "USD")
        "from": formatted_date,
        "until": formatted_date
    }
    
    # Make the API request and get the response
    response = requests.get(url, headers=headers, params=querystring)
   # Check if the response is valid
    if response.status_code == 200:
        data = response.json()  # Parse the JSON data from the response
        
        # Transform the response into the required format
        candles = []
        for candle in data:
            formatted_candle = {
                "timestamp": candle["date"],  # Using the "date" field as the timestamp
                "open": float(candle["open"]),
                "high": float(candle["high"]),
                "low": float(candle["low"]),
                "close": float(candle["close"]),
                "volume": int(candle["volume"])
            }
            candles.append(formatted_candle)

        return candles
    else:
        raise Exception("Error fetching forex data: " + response.text)

# import os
# from polygon import RESTClient
# from datetime import datetime, timedelta
# import pytz

# api_key = os.getenv("POLYGON_API_KEY")

# client = RESTClient(api_key) 

# def get_forex_data(pair="EURUSD", multiplier=1, timespan="minute", lookback_minutes=180):
#     to_time = datetime.now(pytz.UTC)
#     from_time = to_time - timedelta(minutes=lookback_minutes)
    
#     pair_symbol = f"C:{pair.upper()}"
#     aggs = []

#     for candle in client.list_aggs(
#         pair_symbol,
#         multiplier,
#         timespan,
#         from_time.strftime("%Y-%m-%d"),
#         to_time.strftime("%Y-%m-%d"),
#         limit=1000,
#         sort="asc"
#     ):
#         aggs.append({
#             "timestamp": candle.timestamp,
#             "open": candle.open,
#             "high": candle.high,
#             "low": candle.low,
#             "close": candle.close
#         })

#     return aggs