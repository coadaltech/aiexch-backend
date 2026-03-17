/**
 * Shared enums for database and application-level constants.
 * These map directly to integer values stored in the database.
 */

/** Soft-delete / row lifecycle status — used in every table's `record_status` column. */
export enum RecordStatus {
  Active = 0,
  Deleted = 1,
  Suspended = 2,
}

/** Bet direction — stored in `transactions.bet_type` and `transaction_details.bet_type`. */
export enum BetType {
  Back = 0,
  Lay = 1,
}

/** Helper: convert a "back"/"lay" string (e.g. from API request body) to BetType number. */
export function parseBetType(value: string): BetType {
  switch (value.toLowerCase()) {
    case "back":
      return BetType.Back;
    case "lay":
      return BetType.Lay;
    default:
      throw new Error(`Invalid bet type: ${value}`);
  }
}

/** Helper: convert BetType number back to display string. */
export function betTypeToString(value: BetType): "back" | "lay" {
  return value === BetType.Back ? "back" : "lay";
}

/** User role hierarchy — stored in `users.role`. Values match group_id. */
export enum UserRole {
  Owner = 0,
  Admin = 3,
  Super = 4,
  Master = 5,
  Agent = 6,
  User = 7,
}

/** Helper: convert a role string (e.g. from API body) to UserRole number. */
export function parseUserRole(value: string): UserRole {
  switch (value.toLowerCase()) {
    case "owner":
      return UserRole.Owner;
    case "admin":
      return UserRole.Admin;
    case "super":
      return UserRole.Super;
    case "master":
      return UserRole.Master;
    case "agent":
      return UserRole.Agent;
    case "user":
      return UserRole.User;
    default:
      return UserRole.User;
  }
}

/** Helper: convert UserRole number back to display string. */
export function roleToString(value: UserRole | number): string {
  switch (value) {
    case UserRole.Owner:
      return "owner";
    case UserRole.Admin:
      return "admin";
    case UserRole.Super:
      return "super";
    case UserRole.Master:
      return "master";
    case UserRole.Agent:
      return "agent";
    case UserRole.User:
      return "user";
    default:
      return "user";
  }
}

/** Profile membership tier — stored in `profiles.membership`. */
export enum MembershipType {
  Bronze = 0,
  Silver = 1,
  Gold = 2,
  Platinum = 3,
}

/** Helper: convert a membership string to MembershipType number. */
export function parseMembership(value: string): MembershipType {
  switch (value.toLowerCase()) {
    case "bronze":
      return MembershipType.Bronze;
    case "silver":
      return MembershipType.Silver;
    case "gold":
      return MembershipType.Gold;
    case "platinum":
      return MembershipType.Platinum;
    default:
      return MembershipType.Bronze;
  }
}

/** Helper: convert MembershipType number back to display string. */
export function membershipToString(value: MembershipType | number): string {
  switch (value) {
    case MembershipType.Bronze:
      return "bronze";
    case MembershipType.Silver:
      return "silver";
    case MembershipType.Gold:
      return "gold";
    case MembershipType.Platinum:
      return "platinum";
    default:
      return "bronze";
  }
}
