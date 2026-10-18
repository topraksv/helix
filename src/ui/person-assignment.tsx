import { tr } from "../i18n/tr";
import { Body, ChipPicker, Label } from "./components";
import { spacing, type } from "./theme";

interface AssignablePerson {
  id: string;
  name: string;
  isSelf: boolean;
}

/** The owner's pick, else the self person, else the first; persons load live, so this is derived, never frozen in state. */
export const assignedPersonId = (choice: string | null, people: readonly { id: string; isSelf: boolean }[]) =>
  choice ?? people.find((person) => person.isSelf)?.id ?? people[0]?.id ?? null;

/**
 * Person ownership is only a choice after the user starts tracking somebody
 * else. Until then a one-line route hint preserves discoverability without
 * making every form look as if a decision is missing.
 */
export function PersonAssignment({
  label,
  people,
  value,
  onChange,
}: {
  label: string;
  people: AssignablePerson[];
  value: string | null;
  onChange: (personId: string) => void;
}) {
  if (people.length > 1) {
    return (
      <>
        <Label>{label}</Label>
        <ChipPicker
          options={people.map((person) => ({ value: person.id, label: person.name }))}
          value={value}
          onChange={onChange}
        />
        {people.find((person) => person.id === value)?.isSelf === false ? (
          <Body muted style={{ fontSize: type.small.fontSize, marginBottom: spacing.md }}>{tr.persons.watchedHint}</Body>
        ) : null}
      </>
    );
  }

  return (
    <Body testID="person-assignment-hint" muted style={{ fontSize: type.small.fontSize, marginBottom: spacing.md }}>
      {tr.persons.soloAssignmentHint}
    </Body>
  );
}
