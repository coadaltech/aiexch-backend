ALTER TABLE "voucher_details" ALTER COLUMN "added_date" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "voucher_details" ALTER COLUMN "added_date" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "voucher_details" ALTER COLUMN "update_date" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "voucher_details" ALTER COLUMN "update_date" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "vouchers" ALTER COLUMN "added_date" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vouchers" ALTER COLUMN "added_date" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "vouchers" ALTER COLUMN "update_date" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vouchers" ALTER COLUMN "update_date" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "voucher_details" ADD COLUMN "voucher_date" date DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "voucher_date" date DEFAULT now() NOT NULL;