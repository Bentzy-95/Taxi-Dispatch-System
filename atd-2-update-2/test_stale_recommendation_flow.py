import json, os, urllib.request

BASE = "http://localhost:3000/api/trpc"
ACCESS_CODE = os.environ.get("ACCESS_CODE", "")

def call(proc, input_data, method="POST"):
    if method == "GET":
        q = urllib.parse.urlencode({"input": json.dumps({"json": input_data})})
        req = urllib.request.Request(f"{BASE}/{proc}?{q}", method="GET", headers={"x-access-code": ACCESS_CODE})
    else:
        body = json.dumps({"json": input_data}).encode()
        req = urllib.request.Request(f"{BASE}/{proc}", data=body, method="POST",
            headers={"x-access-code": ACCESS_CODE, "Content-Type": "application/json"})
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)["result"]["data"]["json"]

print("== Reproducing the stuck 'DONE column still shows Accept/Reject' bug ==")

booking = call("bookings.create", {
    "passengerName": "Benzion-style Booking",
    "passengerPhone": "07700900777",
    "passengerCount": 1,
    "scheduledTime": "2026-08-04T09:12:00Z",
    "pickupLocation": "geneva airport",
    "dropoffLocation": "Val Thorens",
})
rec_id = booking["recommendation"]["id"]
print(f"Booking created with no driver match, recommendation #{rec_id} is pending (as expected, no drivers exist yet)")

# Admin marks it completed directly, bypassing the recommendation entirely -
# exactly what would happen via drag-and-drop or the mobile status button.
call("bookings.updateStatus", {"bookingId": booking["booking"]["id"], "status": "completed"})
print("Booking marked completed directly (bypassing the recommendation).")

pending = call("recommendations.pending", None, method="GET")
still_stuck = [r for r in pending if r["id"] == rec_id]
assert len(still_stuck) == 0, f"BUG STILL PRESENT: recommendation #{rec_id} is still pending after completion"
print(f">>> CONFIRMED: recommendation #{rec_id} is no longer pending - won't show a stuck Accept/Reject anymore <<<")
