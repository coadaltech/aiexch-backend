CREATE TABLE "vouchers" (
	"id" bigint PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"type" varchar(50) NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"currency" varchar(10) DEFAULT 'INR',
	"status" varchar(20) DEFAULT 'pending',
	"method" varchar(50),
	"reference" varchar(255),
	"txn_hash" varchar(255),
	"proof_image" text,
	"withdrawl_address" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "transactions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "transactions" CASCADE;--> statement-breakpoint
ALTER TABLE "whitelabels" ALTER COLUMN "permissions" SET DEFAULT '{"casino":true,"sports":true,"liveCasino":true,"promotions":true,"vouchers":true,"userManagement":false,"reports":false,"settings":false}';--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;