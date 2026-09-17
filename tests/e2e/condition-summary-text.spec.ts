// End-to-end coverage for the item card's one-line condition text: it has to explain a
// compound condition, not just name the operator. Mystic Aura (Group) is gated on
// `party AND NOT equipped(mystic-aura-self)`.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder, slotRow, chooseItem, addListRows } from "./support/app";
import { shippedItemName } from "./support/shippedData";

/** The item the `not` gate excludes, read the way the label shows it: by name. */
const SELF_AURA = shippedItemName("mystic-aura-self");

const GROUP_SLOT = "group.group#1";
const MOUNT_SLOT = "mounts.mountEquip";

/** Equips the group aura and the self aura the group aura's `not` gate excludes, then hovers
 *  the group row. The card only lists what a gate needs while the bonus is inactive, which is
 *  exactly what equipping the self aura makes it. */
async function openBlockedGroupAuraCard(page: Page) {
  await openBuilder(page);
  // Group is an item_picker_list: a fresh build has no rows until one is added.
  await addListRows(page, "group.group");
  await chooseItem(
    page,
    GROUP_SLOT,
    shippedItemName("mystic-aura-group-celestial"),
  );
  await chooseItem(page, MOUNT_SLOT, shippedItemName("mystic-aura-self"));
  // Scroll the row into place before hovering: the hover card closes on any scroll, so a
  // hover that has to scroll the row into view first would cancel itself.
  await slotRow(page, GROUP_SLOT).scrollIntoViewIfNeeded();
  await slotRow(page, GROUP_SLOT).hover();
  return page.getByTestId("item-card"); // the floating hover card
}

test("the unmet `needs ...` line names what the `not` negates, not just the operator", async ({
  page,
}) => {
  const card = await openBlockedGroupAuraCard(page);

  const unmet = card.getByTestId("item-card-bonus-unmet");
  await expect(unmet).toHaveCount(1);
  await expect(unmet).toContainText(`needs not 1× ${SELF_AURA}`);
});
