/**
 * Taksitler, opened from OUTSIDE the Financial Table's own tab.
 *
 * The same screen exists at `(tabs)/cash-flow/installments` for the in-tab
 * route. Durum's card statement row pushed there, into a tab stack that had
 * never mounted its own index, so the stack held Taksitler alone: Back went to
 * Durum, and because that tab pops to the top of its stack when it loses
 * focus, and the top WAS Taksitler, the Mali Tablo tab showed Taksitler from
 * then on until the app was restarted. Pushed at the root, the stack below it
 * is the screen the user came from and the tab's own stack is never touched.
 */

export { default } from "./(tabs)/cash-flow/installments";
