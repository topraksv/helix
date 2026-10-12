import { Tabs } from "expo-router";
import ChartPie from "lucide-react-native/icons/chart-pie";
import Landmark from "lucide-react-native/icons/landmark";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import Settings from "lucide-react-native/icons/settings";
import WalletCards from "lucide-react-native/icons/wallet-cards";
import { tr } from "../../i18n/tr";
import { useReducedMotion } from "../../ui/motion";
import { selectionTapIfChanged } from "../../ui/haptics";
import { TabBar } from "../../ui/tab-bar";
import { useTheme } from "../../ui/theme";

const TAB_SCREENS = [
  { name: "index", label: tr.tabs.dashboard, Icon: ChartPie, popToTopOnBlur: undefined },
  { name: "cash-flow", label: tr.tabs.cashflow, Icon: WalletCards, popToTopOnBlur: true },
  { name: "subscriptions", label: tr.tabs.subscriptions, Icon: RefreshCw, popToTopOnBlur: undefined },
  { name: "investments", label: tr.tabs.investments, Icon: Landmark, popToTopOnBlur: undefined },
  { name: "settings", label: tr.tabs.settings, Icon: Settings, popToTopOnBlur: true },
];

export default function TabsLayout() {
  const reducedMotion = useReducedMotion();
  const { palette } = useTheme();
  return (
    <Tabs
      // The bar floats over the scene, so it draws itself rather than being
      // laid out by the navigator. Metrics stay in the shared TAB_BAR tokens
      // (theme.ts); `Screen` and the undo snackbar read the same source.
      tabBar={(props) => <TabBar {...props} />}
      screenListeners={({ navigation, route }) => ({
        tabPress: () => {
          const state = navigation.getState();
          selectionTapIfChanged(state.routes[state.index]?.key, route.key);
        },
      })}
      screenOptions={{
        // Screens draw their own large titles; a native header would repeat them.
        headerShown: false,
        // A tab change is a change of place; a hard cut reads as a repaint.
        // `fade`, not `shift`: the tabs are peers, not a sequence. On native it
        // relies on expo/expo#49778, applied by `scripts/patch-dependencies.mjs`.
        // The navigator ignores Reduce Motion, so it is applied here.
        animation: reducedMotion ? "none" : "fade",
        // A keyboard is an editing state, not navigation. Hiding the floating
        // bar gives the active field room and avoids a second opaque strip
        // competing with the keyboard on compact devices.
        tabBarHideOnKeyboard: true,
        // No left inset here. The rail is a floating panel centred on its own
        // axis, not a column the scene stands beside, so a nested stack's header
        // spans the whole window as a header should; padding the scene cut that
        // header short and left a notch of background beside it. `Screen` insets
        // its own content, which is the only thing the rail can reach.
        sceneStyle: { backgroundColor: palette.background },
      }}
    >
      {TAB_SCREENS.map(({ name, label, Icon, popToTopOnBlur }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title: label,
            tabBarAccessibilityLabel: label,
            popToTopOnBlur,
            tabBarIcon: ({ color, size }) => <Icon color={color} size={size - 2} strokeWidth={2} />,
          }}
        />
      ))}
    </Tabs>
  );
}
