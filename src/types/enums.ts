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

/** Market type — stored in `transactions.market_type`. */
export enum MarketType {
  MatchOdds = 0,
  TiedMatch = 1,
  CompleteMatch = 2,
  Bookmaker = 3,
  Fancy = 4,
}

/**
 * Helper: convert bettingType + marketType strings to MarketType number.
 * bettingType comes from the external API: "ODDS", "BOOKMAKER", "LINE"
 * marketType comes from the external API: "MATCH_ODDS", "TIED_MATCH", "COMPLETED_MATCH", etc.
 * When bettingType is "ODDS", we use marketType to distinguish MatchOdds / TiedMatch / CompleteMatch.
 */
export function parseMarketType(
  bettingType: string | null | undefined,
  marketType?: string | null | undefined,
): MarketType {
  switch (bettingType?.toLowerCase()) {
    case "bookmaker":
    case "bookmakers":
      return MarketType.Bookmaker;
    case "line":
    case "sessions":
    case "fancy":
      return MarketType.Fancy;
    default: {
      // bettingType is "ODDS" or fallback — check marketType to distinguish
      switch (marketType?.toUpperCase()) {
        case "TIED_MATCH":
          return MarketType.TiedMatch;
        case "COMPLETED_MATCH":
        case "COMPLETE_MATCH":
          return MarketType.CompleteMatch;
        default:
          return MarketType.MatchOdds;
      }
    }
  }
}

/** Helper: convert MarketType number back to display string. */
export function marketTypeToString(value: MarketType | number | null): string {
  switch (value) {
    case MarketType.MatchOdds:
      return "match_odds";
    case MarketType.TiedMatch:
      return "tied_match";
    case MarketType.CompleteMatch:
      return "complete_match";
    case MarketType.Bookmaker:
      return "bookmaker";
    case MarketType.Fancy:
      return "fancy";
    default:
      return "match_odds";
  }
}

/** Voucher type — stored in `vouchers.type`. */
export enum VoucherType {
  Credit = 0,
  Debit = 1,
  Limit = 2,
  Deposit = 3,
  Withdraw = 4,
  Bonus = 5,
  Settlement = 6,
}

/** Helper: convert a voucher type string to VoucherType number. */
export function parseVoucherType(value: string): VoucherType {
  switch (value.toLowerCase()) {
    case "credit":
      return VoucherType.Credit;
    case "debit":
      return VoucherType.Debit;
    case "limit":
      return VoucherType.Limit;
    case "deposit":
      return VoucherType.Deposit;
    case "withdraw":
      return VoucherType.Withdraw;
    case "bonus":
      return VoucherType.Bonus;
    case "settlement":
      return VoucherType.Settlement;
    default:
      throw new Error(`Invalid voucher type: ${value}`);
  }
}

/** Helper: convert VoucherType number back to display string. */
export function voucherTypeToString(value: VoucherType | number): string {
  switch (value) {
    case VoucherType.Credit:
      return "credit";
    case VoucherType.Debit:
      return "debit";
    case VoucherType.Limit:
      return "limit";
    case VoucherType.Deposit:
      return "deposit";
    case VoucherType.Withdraw:
      return "withdraw";
    case VoucherType.Bonus:
      return "bonus";
    case VoucherType.Settlement:
      return "settlement";
    default:
      return "credit";
  }
}

/** Voucher status — stored in `vouchers.status`. */
export enum VoucherStatus {
  Pending = 0,
  Approved = 1,
  Rejected = 2,
}

/** Helper: convert a voucher status string to VoucherStatus number. */
export function parseVoucherStatus(value: string): VoucherStatus {
  switch (value.toLowerCase()) {
    case "pending":
      return VoucherStatus.Pending;
    case "approved":
      return VoucherStatus.Approved;
    case "rejected":
      return VoucherStatus.Rejected;
    default:
      return VoucherStatus.Pending;
  }
}

/** Helper: convert VoucherStatus number back to display string. */
export function voucherStatusToString(value: VoucherStatus | number): string {
  switch (value) {
    case VoucherStatus.Pending:
      return "pending";
    case VoucherStatus.Approved:
      return "approved";
    case VoucherStatus.Rejected:
      return "rejected";
    default:
      return "pending";
  }
}

/** Debit/Credit direction — stored in `voucher_details.dr_cr`. */
export enum DrCr {
  Debit = 0,
  Credit = 1,
}

/** Helper: convert a dr/cr string to DrCr number. */
export function parseDrCr(value: string): DrCr {
  switch (value.toUpperCase()) {
    case "DEBIT":
      return DrCr.Debit;
    case "CREDIT":
      return DrCr.Credit;
    default:
      throw new Error(`Invalid DrCr value: ${value}`);
  }
}

/** Helper: convert DrCr number back to display string. */
export function drCrToString(value: DrCr | number): string {
  return value === DrCr.Debit ? "DEBIT" : "CREDIT";
}

/** Sport type — stored in `matka_shifts.sport_type` to differentiate Matka vs Jambo shifts. */
export enum MatkaSportType {
  Matka = 1001,
  Jambo = 1004,
  BombayBazar = 1005,
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
