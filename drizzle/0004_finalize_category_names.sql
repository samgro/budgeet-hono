ALTER TABLE "categories" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ALTER COLUMN "primary_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" DROP COLUMN "description";--> statement-breakpoint
ALTER TABLE "categories" DROP COLUMN "icon_url";