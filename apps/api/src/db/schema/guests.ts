import { sql } from "drizzle-orm";
import { date, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { ID_PROOF_TYPES } from "./enums.js";

export const FOLLOW_UP_STATUSES = ["pending", "done", "cancelled"] as const;

export const guests = pgTable(
  "guests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fullName: text("full_name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    idProofType: text("id_proof_type", { enum: ID_PROOF_TYPES }).notNull(),
    idProofNumberEncrypted: text("id_proof_number_encrypted").notNull(),
    idProofLast4: text("id_proof_last4").notNull(),
    address: text("address"),
    city: text("city"),
    state: text("state"),
    nationality: text("nationality").notNull().default("Indian"),
    dateOfBirth: date("date_of_birth"),
    companyName: text("company_name"),
    gstin: text("gstin"),
    notes: text("notes"),
    tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
    idProofPhotoFront: text("id_proof_photo_front"),
    idProofPhotoBack: text("id_proof_photo_back"),
    guestPhoto: text("guest_photo"),
    kycVerifiedAt: timestamp("kyc_verified_at", { withTimezone: true }),
    kycVerifiedBy: uuid("kyc_verified_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    phoneUnique: uniqueIndex("idx_guests_phone_unique").on(t.phone),
    fullNameSearch: index("idx_guests_full_name").using(
      "gin",
      sql`to_tsvector('english', ${t.fullName})`,
    ),
  }),
);

export type Guest = typeof guests.$inferSelect;
export type NewGuest = typeof guests.$inferInsert;

export const guestNotes = pgTable(
  "guest_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guestId: uuid("guest_id")
      .notNull()
      .references(() => guests.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    authorId: uuid("author_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    guestIdx: index("idx_guest_notes_guest").on(t.guestId),
  }),
);

export const guestFollowUps = pgTable(
  "guest_follow_ups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guestId: uuid("guest_id")
      .notNull()
      .references(() => guests.id, { onDelete: "cascade" }),
    task: text("task").notNull(),
    dueDate: date("due_date").notNull(),
    status: text("status", { enum: FOLLOW_UP_STATUSES }).notNull().default("pending"),
    assignedTo: uuid("assigned_to"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    guestIdx: index("idx_guest_followups_guest").on(t.guestId),
    statusIdx: index("idx_guest_followups_status_due").on(t.status, t.dueDate),
  }),
);
