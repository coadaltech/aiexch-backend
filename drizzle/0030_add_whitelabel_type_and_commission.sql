-- Create enum type for whitelabel type
CREATE TYPE "whitelabel_type" AS ENUM('B2B', 'B2C');

-- Add whitelabel_type column with default value
ALTER TABLE "whitelabels" ADD COLUMN "whitelabel_type" "whitelabel_type" NOT NULL DEFAULT 'B2C';

-- Add commission_percentage column with default value
ALTER TABLE "whitelabels" ADD COLUMN "commission_percentage" numeric(5,2) NOT NULL DEFAULT '0.00';
