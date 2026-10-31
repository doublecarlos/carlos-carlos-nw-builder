// End-to-end coverage for the item card's one-line condition text: it has to explain a
// compound condition, not just name the operator. The test group aura is gated on
// `party AND NOT equipped(test-self-aura)`.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder, slotRow, chooseItem, addListRows } from "./support/app";
import { importTestCatalog } from "./support/testCatalog";

/** The item the `not` gate excludes, read the way the label shows it: by name. */
const SELF_AURA = "Test Self Aura";
const GROUP_AURA = "Test Group Aura";

const GROUP_SLOT = "group.group#1";
const MOUNT_SLOT = "mounts.mountEquip";

/** Equips the group aura and the self aura the group aura's `not` gate excludes, then hovers
 *  the group row. The card only lists what a gate needs while the bonus is inactive, which is
 *  exactly what equipping the self aura makes it. */
async function openBlockedGroupAuraCard(page: Page) {
  await openBuilder(page);
  await importTestCatalog(page, {
    items: [
      { id: "test-self-aura", name: SELF_AURA, filter: "mount_equip" },
      {
        id: "test-group-aura",
        name: GROUP_AURA,
        filter: "group_buff",
        bonuses: ["test-group-aura"],
      },
    ],
    bonuses: [
      {
        id: "test-group-aura",
        name: GROUP_AURA,
        grants: [
          {
            when: {
              toggle: "party",
              not: { equipped: { item: "test-self-aura" } },
            },
            stats: { power: 100 },
          },
        ],
      },
    ],
  });
  // Group is an item_picker_list: a fresh build has no rows until one is added.
  await addListRows(page, "group.group");
  await chooseItem(page, GROUP_SLOT, GROUP_AURA);
  await chooseItem(page, MOUNT_SLOT, SELF_AURA);
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
