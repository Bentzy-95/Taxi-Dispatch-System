import json
import os
import urllib.request
import urllib.parse
from datetime import datetime, timedelta, timezone

BASE = "http://localhost:3000/api/trpc"
ACCESS_CODE = os.environ.get("ACCESS_CODE", "")


def call(proc, input_data=None, method="POST"):
    headers = {"x-access-code": ACCESS_CODE}
    if method == "GET":
        q = urllib.parse.urlencode({"input": json.dumps({"json": input_data})})
        req = urllib.request.Request(f"{BASE}/{proc}?{q}", method="GET", headers=headers)
    else:
        body = json.dumps({"json": input_data}).encode()
        headers["Content-Type"] = "application/json"
        req = urllib.request.Request(f"{BASE}/{proc}", data=body, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.load(resp)
    except urllib.error.HTTPError as e:
        b = json.loads(e.read().decode())
        err = b.get("error", {}).get("json", b.get("error", {}))
        raise SystemExit(f"HTTP {e.code} calling {proc}: {err.get('message')}")
    return data["result"]["data"]["json"]


print("== Chain-matching live test: Geneva Airport -> Val Thorens scenario ==")

vehicle = call("vehicles.create", {"name": "Kia Sorento", "seats": 7})
driver = call("drivers.create", {"name": "Marc", "phone": "07700900099", "vehicleId": vehicle["id"]})

base_time = datetime(2026, 8, 5, 6, 0, 0, tzinfo=timezone.utc)

# Job 1: Marc drives a client FROM Val Thorens TO Geneva Airport, 3hr estimated.
job1 = call("bookings.create", {
    "passengerName": "Existing Client",
    "passengerPhone": "07700900001",
    "passengerCount": 2,
    "scheduledTime": base_time.isoformat(),
    "pickupLocation": "Chalet Edelweiss, Val Thorens",
    "dropoffLocation": "Geneva Airport",
    "estimatedDurationMinutes": 180,
})
print(f"Job 1 created: {job1['booking']['bookingNumber']} (Val Thorens -> Geneva, 6:00am, 3hr)")

# Manually assign Marc to job 1 (simulating admin accepting a solo assignment).
call("bookings.manualAssign", {
    "bookingId": job1["booking"]["id"],
    "driverId": driver["id"],
    "vehicleId": vehicle["id"],
})
print("Job 1 assigned to Marc.")

# Job 2: a NEW client landing at Geneva Airport at 9:40am (40 min after Marc's ~9:00am estimated free time),
# heading to a DIFFERENT location (a different hotel in Val Thorens) - a separate trip, not a shared car.
pickup_time_2 = base_time + timedelta(hours=3, minutes=40)
job2 = call("bookings.create", {
    "passengerName": "New Arrival",
    "passengerPhone": "07700900002",
    "passengerCount": 3,
    "scheduledTime": pickup_time_2.isoformat(),
    "pickupLocation": "Geneva Airport",
    "dropoffLocation": "Hotel Fitz Roy, Val Thorens",
})
print(f"Job 2 created: {job2['booking']['bookingNumber']} (Geneva -> Hotel Fitz Roy, 9:40am)")

rec = job2["recommendation"]
print(f"\nRecommendation reasoning: {rec['reasoning']}")
assert rec["suggestedDriverId"] == driver["id"], f"Expected Marc ({driver['id']}) to be suggested, got {rec['suggestedDriverId']}"
assert rec["groupWithBookingId"] is None, "This must NOT be a shared-car group - it's a separate follow-on trip"
print(">>> CONFIRMED: the engine suggested reusing Marc for the new Geneva pickup instead of a different driver <<<")

# Accept it and confirm it lands as a real, separate assignment (no groupId).
accepted = call("recommendations.accept", {"recommendationId": rec["id"]})
assert accepted["driverId"] == driver["id"]
assert accepted["groupId"] is None
print(">>> CONFIRMED: accepted cleanly as job 2, driver Marc, no shared groupId with job 1 <<<")

print("\nALL CHAIN-MATCHING CHECKS PASSED")
