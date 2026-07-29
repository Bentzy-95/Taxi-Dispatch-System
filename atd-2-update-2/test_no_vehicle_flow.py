import json, os, urllib.request

BASE = "http://localhost:3000/api/trpc"
ACCESS_CODE = os.environ.get("ACCESS_CODE", "")

def call(proc, input_data):
    body = json.dumps({"json": input_data}).encode()
    req = urllib.request.Request(f"{BASE}/{proc}", data=body, method="POST",
        headers={"x-access-code": ACCESS_CODE, "Content-Type": "application/json"})
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)["result"]["data"]["json"]

print("== Reproducing your exact complaint: driver IS available, system won't assign ==")

# Driver created and marked available, but WITHOUT a vehicle - exactly the trap in the old UI.
driver = call("drivers.create", {"name": "Available Dave", "phone": "07700900555"})
print(f"Driver created: {driver['name']}, status={driver['status']}, vehicleId={driver['vehicleId']}")
assert driver["status"] == "available"
assert driver["vehicleId"] is None

booking = call("bookings.create", {
    "passengerName": "Frustrated Client",
    "passengerPhone": "07700900556",
    "passengerCount": 2,
    "scheduledTime": "2026-08-10T10:00:00Z",
    "pickupLocation": "Hotel A",
    "dropoffLocation": "Hotel B",
})
reasoning = booking["recommendation"]["reasoning"]
print(f"\nOLD message would have said: 'No available driver currently has a vehicle with enough seats...' (misleading - implies wrong vehicle size)")
print(f"NEW message says: '{reasoning}'")
assert "no vehicle assigned" in reasoning, f"Fix didn't take effect: {reasoning}"
assert booking["recommendation"]["suggestedDriverId"] is None
print("\n>>> CONFIRMED: message now correctly points at the real, fixable cause <<<")
