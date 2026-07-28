import json
import os
import urllib.request
import urllib.parse
from datetime import datetime, timedelta, timezone

BASE = "http://localhost:3000/api/trpc"
ACCESS_CODE = os.environ.get("ACCESS_CODE", "")


def call(proc, input_data=None, method="POST", use_access_code=True):
    headers = {"x-access-code": ACCESS_CODE} if use_access_code else {}
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
        body = json.loads(e.read().decode())
        error_obj = body.get("error", {}).get("json", body.get("error", {}))
        return {"__error__": e.code, "__message__": error_obj.get("message", ""), "__raw__": body}
    return data["result"]["data"]["json"]


print("== 0. Access control ==")
no_auth = call("vehicles.list", {}, method="GET", use_access_code=False)
assert no_auth.get("__error__") == 401
print("Confirmed: blocked without passcode")


print("\n== 1. Fleet setup ==")
vehicle_small = call("vehicles.create", {"name": "Toyota Prius", "seats": 4})
vehicle_big = call("vehicles.create", {"name": "Ford Transit", "seats": 8})
driver_a = call("drivers.create", {"name": "Dave", "phone": "07700900000", "vehicleId": vehicle_small["id"]})
driver_b = call("drivers.create", {"name": "Priya", "phone": "07700900001", "vehicleId": vehicle_big["id"]})
print(f"Vehicles: {vehicle_small['name']} ({vehicle_small['seats']} seats), {vehicle_big['name']} ({vehicle_big['seats']} seats)")
print(f"Drivers: {driver_a['name']}, {driver_b['name']}")

base_time = datetime.now(timezone.utc) + timedelta(hours=2)


print("\n== 2. CLEAN ERROR MESSAGES: deliberately trigger a validation error ==")
bad_booking = call(
    "bookings.create",
    {
        "passengerName": "",  # deliberately invalid - blank required field
        "passengerPhone": "07000000000",
        "passengerCount": 1,
        "scheduledTime": base_time.isoformat(),
        "pickupLocation": "Somewhere",
        "dropoffLocation": "Somewhere else",
    },
)
assert bad_booking.get("__error__") == 400, f"Expected a 400 error, got {bad_booking}"
message = bad_booking["__message__"]
print(f"Error message shown to user: {message!r}")
assert message == "Passenger name is required", f"Error message is not clean plain English: {message!r}"
raw_error_json = bad_booking["__raw__"]["error"]["json"]
assert "stack" not in raw_error_json.get("data", {}), "Internal stack trace is leaking to the client - not professional"
print("Confirmed: no internal stack trace leaks to the browser")
assert "{" not in message and "code" not in message.lower(), "Error message looks like raw technical output, not plain English"
print(">>> CONFIRMED: validation errors are clean plain English, not a raw code dump <<<")


print("\n== 3. POINT-TO-POINT BOOKING: no flight number, no airport code at all ==")
city_ride = call(
    "bookings.create",
    {
        "passengerName": "Nadia Khan",
        "passengerPhone": "07000000010",
        "passengerCount": 2,
        "scheduledTime": base_time.isoformat(),
        "pickupLocation": "14 Elm Grove, Manchester",
        "dropoffLocation": "The Ivy Restaurant, Manchester",
        # deliberately no flightNumber, no airportCode
    },
)
assert "__error__" not in city_ride, f"A booking with no flight/airport info should be allowed: {city_ride}"
print(f"Booking created fine with no flight/airport info: {city_ride['booking']['bookingNumber']}")
print(">>> CONFIRMED: flight number and airport are no longer required <<<")


print("\n== 4. THE EXACT REPORTED BUG: 3 passengers + 4 passengers into an 8-seat vehicle ==")
first = call(
    "bookings.create",
    {
        "passengerName": "Group One",
        "passengerPhone": "07000000020",
        "passengerCount": 3,
        "scheduledTime": (base_time + timedelta(hours=1)).isoformat(),
        "pickupLocation": "Manchester Piccadilly Station",
        "dropoffLocation": "Trafford Centre",
    },
)
print("First group's recommendation (not accepted yet):", first["recommendation"]["reasoning"])

second = call(
    "bookings.create",
    {
        "passengerName": "Group Two",
        "passengerPhone": "07000000021",
        "passengerCount": 4,
        "scheduledTime": (base_time + timedelta(hours=1, minutes=5)).isoformat(),
        "pickupLocation": "Manchester Piccadilly Station",
        "dropoffLocation": "Trafford Centre",
    },
)
print("Second group's recommendation:", second["recommendation"]["reasoning"])
assert second["recommendation"]["groupWithBookingId"] == first["booking"]["id"], (
    f"3+4=7 passengers should combine into the 8-seat vehicle, but did not. Got: {second['recommendation']}"
)
assert second["recommendation"]["suggestedVehicleId"] == vehicle_big["id"], "Should pick the 8-seat vehicle, not the 4-seat one"
print(">>> CONFIRMED: 3 + 4 = 7 passengers correctly combined into the 8-seat vehicle <<<")

accepted_second = call("recommendations.accept", {"recommendationId": second["recommendation"]["id"]})
print(f"Combined group assigned to driver {accepted_second['driverId']} (should be Priya/8-seat)")
assert accepted_second["driverId"] == driver_b["id"]


print("\n== 5. DELETE A BOOKING ==")
to_delete = call(
    "bookings.create",
    {
        "passengerName": "Cancel Me",
        "passengerPhone": "07000000030",
        "passengerCount": 1,
        "scheduledTime": (base_time + timedelta(hours=3)).isoformat(),
        "pickupLocation": "Somewhere Random",
        "dropoffLocation": "Somewhere Else Random",
    },
)
cancel_result = call("bookings.cancel", {"bookingId": to_delete["booking"]["id"]})
assert cancel_result.get("cancelled") is True
all_bookings = call("bookings.list", {}, method="GET")
deleted_row = next(b for b in all_bookings if b["id"] == to_delete["booking"]["id"])
assert deleted_row["status"] == "cancelled"
board_statuses = {"unassigned", "assigned", "en_route", "completed"}
assert deleted_row["status"] not in board_statuses, "Deleted booking should not appear in any board column"
print(">>> CONFIRMED: booking deleted, no longer shows on the dispatch board <<<")


print("\n== 6. Driver sees both combined jobs (regression check on the original fix) ==")
jobs_a = call("drivers.jobs", {"token": driver_a["token"]}, method="GET", use_access_code=False)
job_names_a = [j["passengerName"] for j in jobs_a["jobs"]]
print("Driver A's (Dave, 4-seat) jobs:", job_names_a)
assert job_names_a == [], "Dave's 4-seat car was never used here - both passengers needed the 8-seat vehicle together"

jobs_b = call("drivers.jobs", {"token": driver_b["token"]}, method="GET", use_access_code=False)
job_names_b = [j["passengerName"] for j in jobs_b["jobs"]]
print("Driver B's (Priya, 8-seat) jobs:", job_names_b)
assert "Group One" in job_names_b and "Group Two" in job_names_b, "Both passengers should be on Priya's job list"
print(">>> CONFIRMED: driver sees all combined passengers correctly, nothing hidden <<<")

print("\nALL CHECKS PASSED")
