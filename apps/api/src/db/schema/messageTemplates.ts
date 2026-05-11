import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const TEMPLATE_KEYS = [
  "checkin_guest_sms",
  "checkin_owner_sms",
  "checkout_guest_sms",
  "checkout_owner_sms",
  "otp_guest_sms",
  "payment_reminder_guest_sms",
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export const messageTemplates = pgTable("message_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  subject: text("subject"),
  body: text("body").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type NewMessageTemplate = typeof messageTemplates.$inferInsert;
