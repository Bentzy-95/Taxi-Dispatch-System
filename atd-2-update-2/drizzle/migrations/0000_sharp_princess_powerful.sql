CREATE TYPE "public"."booking_status" AS ENUM('unassigned', 'assigned', 'en_route', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."driver_status" AS ENUM('available', 'busy', 'offline');--> statement-breakpoint
CREATE TYPE "public"."recommendation_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('available', 'in_use', 'offline');--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_number" varchar(20) NOT NULL,
	"passenger_name" varchar(255) NOT NULL,
	"passenger_phone" varchar(20) NOT NULL,
	"passenger_count" integer DEFAULT 1 NOT NULL,
	"flight_number" varchar(50),
	"airport_code" varchar(10),
	"scheduled_time" timestamp NOT NULL,
	"pickup_location" text NOT NULL,
	"dropoff_location" text NOT NULL,
	"status" "booking_status" DEFAULT 'unassigned' NOT NULL,
	"driver_id" integer,
	"vehicle_id" integer,
	"group_id" varchar(32),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_booking_number_unique" UNIQUE("booking_number")
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"token" varchar(32) NOT NULL,
	"vehicle_id" integer,
	"status" "driver_status" DEFAULT 'available' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "drivers_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_id" integer NOT NULL,
	"suggested_vehicle_id" integer,
	"suggested_driver_id" integer,
	"group_with_booking_id" integer,
	"reasoning" text NOT NULL,
	"confidence" numeric(3, 2),
	"status" "recommendation_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"seats" integer DEFAULT 4 NOT NULL,
	"status" "vehicle_status" DEFAULT 'available' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bookings_status_idx" ON "bookings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bookings_driver_id_idx" ON "bookings" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "bookings_group_id_idx" ON "bookings" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "bookings_scheduled_time_idx" ON "bookings" USING btree ("scheduled_time");--> statement-breakpoint
CREATE INDEX "drivers_token_idx" ON "drivers" USING btree ("token");--> statement-breakpoint
CREATE INDEX "recommendations_booking_id_idx" ON "recommendations" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "recommendations_status_idx" ON "recommendations" USING btree ("status");