import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  PanResponder,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";

const Colors = {
  bg: "#000000",
  surface: "#111113",
  card: "#1C1C1E",
  cardAlt: "#202022",
  border: "#2C2C2E",
  borderStrong: "#3A3A3C",
  text: "#FFFFFF",
  muted: "#8E8E93",
  subtle: "#636366",
  green: "#32D74B",
  greenSoft: "rgba(50, 215, 75, 0.14)",
  greenBorder: "rgba(50, 215, 75, 0.35)",
  blue: "#0A84FF",
  orange: "#FF9F0A",
  yellow: "#FFD60A",
  purple: "#BF5AF2",
  cyan: "#64D2FF",
  red: "#FF453A",
};

type GuideSection = {
  title: string;
  body?: string[];
  steps?: string[];
  bullets?: string[];
  cards?: [string, string][];
  table?: [string, string][];
  callout?: string;
};

type GuideTopic = {
  id: string;
  number: string;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  accent: string;
  readTime: string;
  summary: string;
  sections: GuideSection[];
};

const guideTopics: GuideTopic[] = [
  {
    id: "home",
    number: "01",
    title: "Home",
    subtitle: "Your daily training hub",
    icon: "home-outline",
    accent: Colors.green,
    readTime: "4 min",
    summary:
      "Home tells you what to do next: resume an active workout, start today’s split session, see completed-today status, review this week, and check training momentum.",
    sections: [
      {
        title: "What Home is for",
        body: [
          "Home is not just a launch screen. It is the daily command center for your current training state.",
          "The main card changes depending on whether you have an active workout, a scheduled split day, a rest day, or a completed split workout today.",
        ],
      },
      {
        title: "Home states",
        cards: [
          ["Workout in Progress", "If a live or paused workout exists, Home prioritizes Resume Workout and hides new-start actions."],
          ["Today’s Training", "If your active split has a scheduled template today, Home shows the workout and lets you start it."],
          ["Rest Day", "If your split day is rest, Home keeps Start Empty Workout available without pretending there is a scheduled session."],
          ["Completed Today", "After finishing today’s split workout, Home shows View History and Start Extra Workout."],
        ],
      },
      {
        title: "Weekly insight",
        body: [
          "This Week summarizes workouts, working sets, volume, and training time.",
          "Training Momentum gives a cleaner overview of your current week, last trained date, and next scheduled split session.",
        ],
      },
    ],
  },
  {
    id: "workouts",
    number: "02",
    title: "Workouts",
    subtitle: "Log sets, manage sessions, and finish cleanly",
    icon: "create-outline",
    accent: Colors.orange,
    readTime: "7 min",
    summary:
      "The Workout screen is where you log working sets, use rest timers, view exercise history, replace exercises, and complete sessions.",
    sections: [
      {
        title: "Starting workouts",
        bullets: [
          "Home starts today’s scheduled split workout or an empty workout.",
          "Templates starts a saved workout structure.",
          "Search/Add Exercise uses the unified library with All, Favorites, Recent, and Custom views.",
          "A gym is required before starting so history, machine brands, and filters stay accurate.",
        ],
      },
      {
        title: "Logging sets",
        body: [
          "Enter weight and reps, then complete the set. Completed working sets are used for history, volume, exercise stats, PRs, and charts.",
          "Warm-up sets are excluded from working-set totals and do not trigger the rest timer.",
          "Auto Check Sets can mark sets complete automatically after valid weight and reps are entered.",
        ],
      },
      {
        title: "Workout tools",
        cards: [
          ["Rest Timer", "When enabled, the timer starts after completed working sets, including auto-completed sets."],
          ["Exercise Remarks", "Add notes to a movement for that session. Remarks clear when replacing an exercise."],
          ["View History", "Open exercise-specific history with gym and machine brand filters without leaving the workout."],
          ["Replace Exercise", "Swap a movement while keeping the set rows. This is useful when equipment is taken."],
        ],
      },
      {
        title: "Editing old workouts",
        body: [
          "Opening a completed workout from History enters Edit Workout mode, not Live Session mode.",
          "Gym selection and rest timers are hidden because the workout already happened. Use this mode to correct logged data, not to resume training.",
        ],
      },
      {
        title: "Workout Complete",
        body: [
          "After finishing a live workout, IronVault shows a Workout Complete summary with duration, volume, exercises, sets, PRs, and actions.",
          "Save Image creates a clean 9:16 summary card with volume, exercises, sets, and working sets. PRs and branding are intentionally hidden from the share card.",
        ],
      },
    ],
  },
  {
    id: "templates",
    number: "03",
    title: "Templates & Splits",
    subtitle: "Plan repeatable workouts and active split cycles",
    icon: "clipboard-outline",
    accent: Colors.green,
    readTime: "7 min",
    summary:
      "Templates store repeatable workouts. Folders can become training splits with D1–D9 cycles, rest days, and Home suggestions.",
    sections: [
      {
        title: "Core idea",
        body: [
          "Create templates for workouts you repeat often. Add templates into folders to organize them into a training block or split.",
          "Set a folder as your active split so Home knows what to suggest each day.",
        ],
      },
      {
        title: "Current template behavior",
        bullets: [
          "Create New Template appears only in All.",
          "Folder views are for starting, organizing, and reordering templates already in that folder.",
          "Long-press a template card inside a folder to open the reorder popup.",
          "All has no saved folder order, so reordering is folder-only.",
        ],
      },
      {
        title: "Training split behavior",
        cards: [
          ["Cycle Length", "Use 2–9 days for Upper/Lower, PPL, rest-day cycles, or custom rotations."],
          ["Rest Days", "Split days can be rest days. Home will show Rest Day instead of forcing a workout."],
          ["Primary Split", "The active split controls Today’s Training and Training Momentum on Home."],
        ],
      },
      {
        title: "When a template workout changes",
        table: [
          ["Keep Session Only", "Save the workout history but leave the original template unchanged."],
          ["Save as New Template", "Create a new template from the changed workout after naming it."],
          ["Update Original", "Overwrite the original template structure with the changed workout."],
        ],
      },
    ],
  },
  {
    id: "library",
    number: "04",
    title: "Exercise Library",
    subtitle: "One unified list for built-in, custom, favorites, and recent",
    icon: "barbell-outline",
    accent: Colors.purple,
    readTime: "6 min",
    summary:
      "The Exercise Library is unified. Built-in and custom exercises appear together, with quick views for Favorites, Recent, and Custom.",
    sections: [
      {
        title: "Unified library",
        body: [
          "There is no visible Personal Library / Global Library split anymore. Exercises appear in one library.",
          "Old personal copies of built-in exercises are folded into the built-in row so exercises like Bench Press do not duplicate.",
        ],
      },
      {
        title: "Library views",
        table: [
          ["All", "Every available built-in and custom exercise."],
          ["Favorites", "Exercises you starred for faster access."],
          ["Recent", "Exercises used recently in completed workouts."],
          ["Custom", "Exercises you created yourself."],
        ],
      },
      {
        title: "Exercise cards",
        bullets: [
          "Tap an exercise to open stats and recent performances.",
          "Tap the star to favorite or unfavorite it.",
          "Long-press a custom exercise to edit or delete it.",
          "Built-in exercises are protected from edit/delete actions.",
        ],
      },
      {
        title: "Grouping",
        body: [
          "Exercise lists are grouped by body part using section headers like CHEST, BACK, SHOULDERS, ARMS, LEGS, CORE, and CARDIO.",
        ],
      },
    ],
  },
  {
    id: "custom",
    number: "05",
    title: "Custom Exercises",
    subtitle: "Add movements that do not exist in the library",
    icon: "add-circle-outline",
    accent: Colors.cyan,
    readTime: "4 min",
    summary:
      "Custom exercises are created from the Custom tab and sync with the rest of your library.",
    sections: [
      {
        title: "Creating custom exercises",
        body: [
          "Open the Custom tab and use the Create Custom Exercise card. This keeps the create action contextual and avoids cluttering the top bar.",
          "Custom exercises appear in All, Custom, Favorites if starred, and Recent after being used.",
        ],
      },
      {
        title: "Managing custom exercises",
        bullets: [
          "Long-press a custom exercise card to edit or delete it.",
          "Custom exercises sync to cloud and are included in exports/imports.",
          "Use custom exercises only when the movement does not already exist in the built-in library.",
        ],
      },
    ],
  },
  {
    id: "exercise-stats",
    number: "06",
    title: "Exercise Stats",
    subtitle: "Records, recent performances, gym and brand filters",
    icon: "stats-chart-outline",
    accent: Colors.yellow,
    readTime: "6 min",
    summary:
      "Exercise Stats show your overview, strength records, progress, personal records, and recent performances for one exercise.",
    sections: [
      {
        title: "What you can see",
        cards: [
          ["Overview", "Last done, sessions, working sets, and volume."],
          ["Strength", "Best set and estimated 1RM."],
          ["Personal Records", "Heaviest set, best 1RM estimate, volume session, and rep records."],
          ["Recent Performances", "Past sessions with set-by-set details."],
        ],
      },
      {
        title: "Filters",
        body: [
          "Gym filters use current gym names and stable gym IDs, so renamed gyms stay updated.",
          "Machine brand filters only appear for machine/cable-style exercises. Barbell, dumbbell, and bodyweight exercises do not show machine brand filters.",
        ],
      },
      {
        title: "Variants",
        callout:
          "Normal, Paused, and Tempo variants are tracked separately where supported. Viewing Paused Bench history should not mix with Normal Bench history.",
      },
    ],
  },
  {
    id: "history",
    number: "07",
    title: "History",
    subtitle: "Your completed workout log",
    icon: "journal-outline",
    accent: Colors.green,
    readTime: "5 min",
    summary:
      "History is focused on completed workout sessions. Progress analytics are separate so the log stays clean.",
    sections: [
      {
        title: "Workout log",
        bullets: [
          "The latest workout naturally appears at the top, so there is no separate Latest Session widget.",
          "Search by workout name, exercise name, or gym.",
          "Filter by All, Week, or Month.",
          "Month mode includes previous/next month controls.",
          "Use the gym filter to narrow sessions by location.",
        ],
      },
      {
        title: "Actions",
        table: [
          ["Tap workout", "Open it in Edit Workout mode."],
          ["Long-press workout", "Delete the completed session."],
          ["Progress card", "Open Progress & Statistics for charts and summaries."],
        ],
      },
    ],
  },
  {
    id: "progress",
    number: "08",
    title: "Progress & Statistics",
    subtitle: "Training summary, charts, and trends",
    icon: "analytics-outline",
    accent: Colors.green,
    readTime: "5 min",
    summary:
      "Progress & Statistics contains the analytical view that used to crowd History.",
    sections: [
      {
        title: "Date ranges",
        body: [
          "Use 7D, 30D, 90D, 1Y, and All to analyze different training periods.",
          "The Weekly / Monthly toggle under Progress Trend can be changed independently of the selected range.",
        ],
      },
      {
        title: "What it shows",
        cards: [
          ["Training Summary", "Workouts, sets, total volume, and training time."],
          ["Progress Trend", "Charted volume and performance over time."],
          ["Comparison", "Changes compared with the previous matching period."],
        ],
      },
      {
        title: "History vs Progress",
        callout:
          "History filters help you find sessions. Progress filters help you analyze trends.",
      },
    ],
  },
  {
    id: "gyms",
    number: "09",
    title: "Gyms & Machine Brands",
    subtitle: "Keep location and machine data accurate",
    icon: "business-outline",
    accent: Colors.orange,
    readTime: "5 min",
    summary:
      "Gyms are required so workouts can be tied to a location. Machine brands help keep machine-based history accurate.",
    sections: [
      {
        title: "Gyms",
        body: [
          "Add gyms from Settings or during Initial Setup. A gym is required before starting workouts.",
          "Renaming a gym updates filters and history labels that use that gym ID.",
        ],
      },
      {
        title: "Machine brands",
        bullets: [
          "Set default machine brands per gym for machine/cable-style exercises.",
          "Manual machine brand overrides are preserved.",
          "Changing a gym default only updates exercise tags that were using the old default.",
          "Free weight and bodyweight exercises do not use machine brands.",
        ],
      },
    ],
  },
  {
    id: "gestures",
    number: "10",
    title: "Gestures & Shortcuts",
    subtitle: "Hidden actions and faster navigation",
    icon: "hand-left-outline",
    accent: Colors.cyan,
    readTime: "5 min",
    summary:
      "IronVault uses gestures to keep screens clean while preserving power-user actions.",
    sections: [
      {
        title: "Navigation",
        bullets: [
          "Swipe left-to-right to go back on supported screens.",
          "Use Done, Cancel, or View History on completion screens to leave safely.",
        ],
      },
      {
        title: "Long-press actions",
        table: [
          ["Template card in folder", "Open the template reorder popup."],
          ["Exercise in Workout/Edit Template", "Open reorder/action behavior depending on the screen."],
          ["Custom exercise", "Edit or delete the custom exercise."],
          ["Workout in History", "Delete the workout."],
        ],
      },
      {
        title: "Quick actions",
        bullets: [
          "Tap star to favorite or unfavorite exercises.",
          "Tap View History during a workout to inspect exercise-specific history with gym and brand filters.",
          "Use Custom tab to create custom exercises.",
        ],
      },
    ],
  },
  {
    id: "sync",
    number: "11",
    title: "Sync & Backup",
    subtitle: "Keep your training data safe",
    icon: "cloud-upload-outline",
    accent: Colors.green,
    readTime: "5 min",
    summary:
      "Sync and backup cover workouts, templates, folders, exercises, favorites, gyms, machine brands, and settings.",
    sections: [
      {
        title: "Cloud sync",
        body: [
          "Use Settings → Sync with Cloud to merge local and cloud data without deleting local workouts.",
          "The sync result shows details for workouts, templates, folders, exercises, favorites, gyms, machine brands, and settings.",
        ],
      },
      {
        title: "Manual backups",
        cards: [
          ["Export Backup", "Save a local backup that includes workouts, templates, folders, exercises, favorites, gyms, machine brands, and settings."],
          ["Import Backup", "Restore data from a backup file and review import counts, including Favorites."],
        ],
      },
      {
        title: "Last synced",
        body: [
          "Settings shows the last synced timestamp so you can confirm when your data was last updated.",
        ],
      },
    ],
  },
  {
    id: "tips",
    number: "12",
    title: "Best Practices",
    subtitle: "How to get the most from IronVault",
    icon: "bulb-outline",
    accent: Colors.yellow,
    readTime: "4 min",
    summary:
      "Use IronVault consistently by keeping templates, gyms, favorites, and history clean.",
    sections: [
      {
        title: "Recommended habits",
        bullets: [
          "Create a primary split so Home can show Today’s Training and Training Momentum.",
          "Favorite frequently used exercises to add them faster.",
          "Create custom exercises only when a movement is not already in the library.",
          "Use gym and machine brand filters when comparing machine-based lifts.",
          "Use History to edit completed workouts; do not treat old sessions as live workouts.",
          "Use Progress & Statistics for trends instead of crowding the workout log.",
          "Sync after major changes to gyms, templates, custom exercises, or favorites.",
        ],
      },
    ],
  },
]

type Topic = GuideTopic;

export default function OnboardingGuide({ navigation }: any) {
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);

  const selectedTopic = useMemo(
    () => guideTopics.find((topic) => topic.id === selectedTopicId) || null,
    [selectedTopicId],
  );

  const selectedTopicIndex = useMemo(
    () => guideTopics.findIndex((topic) => topic.id === selectedTopicId),
    [selectedTopicId],
  );

  useEffect(() => {
    // Allow the normal iOS back swipe on the guide index, but disable it inside
    // a detailed topic page so a left-to-right swipe returns to the guide index
    // instead of accidentally leaving the manual.
    navigation?.setOptions?.({ gestureEnabled: !selectedTopic });

    return () => {
      navigation?.setOptions?.({ gestureEnabled: true });
    };
  }, [navigation, selectedTopic]);

  const openTopic = (topicId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedTopicId(topicId);
  };

  const goToTopicByOffset = (offset: number) => {
    if (selectedTopicIndex < 0) return;
    const nextIndex = selectedTopicIndex + offset;
    if (nextIndex < 0 || nextIndex >= guideTopics.length) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedTopicId(guideTopics[nextIndex].id);
  };

  const returnToGuideIndex = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedTopicId(null);
  };

  const goBack = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (selectedTopic) {
      setSelectedTopicId(null);
      return;
    }
    navigation?.goBack?.();
  };

  const topicSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) => {
          if (!selectedTopic) return false;
          const horizontalIntent =
            Math.abs(gestureState.dx) > 28 &&
            Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.4;
          return horizontalIntent && gestureState.dx > 0;
        },
        onPanResponderRelease: (_, gestureState) => {
          if (
            selectedTopic &&
            gestureState.dx > 80 &&
            Math.abs(gestureState.dy) < 70
          ) {
            returnToGuideIndex();
          }
        },
      }),
    [selectedTopic],
  );

  return (
    <SafeAreaView
      style={styles.screen}
      edges={["top", "left", "right"]}
      {...(selectedTopic ? topicSwipeResponder.panHandlers : {})}
    >
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={goBack}
          activeOpacity={0.8}
        >
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>
          {selectedTopic ? selectedTopic.title : "IronVault Guide"}
        </Text>
        <View style={styles.iconButtonPlaceholder} />
      </View>

      {selectedTopic ? (
        <TopicPage
          topic={selectedTopic}
          topicIndex={selectedTopicIndex}
          topicCount={guideTopics.length}
          previousTopic={
            selectedTopicIndex > 0 ? guideTopics[selectedTopicIndex - 1] : null
          }
          nextTopic={
            selectedTopicIndex >= 0 &&
            selectedTopicIndex < guideTopics.length - 1
              ? guideTopics[selectedTopicIndex + 1]
              : null
          }
          onPrevious={() => goToTopicByOffset(-1)}
          onNext={() => goToTopicByOffset(1)}
        />
      ) : (
        <GuideHome onOpenTopic={openTopic} />
      )}
    </SafeAreaView>
  );
}

function GuideHome({ onOpenTopic }: { onOpenTopic: (id: string) => void }) {
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.heroCard}>
        <View style={styles.heroIcon}>
          <Ionicons
            name="shield-checkmark-outline"
            size={30}
            color={Colors.green}
          />
        </View>
        <Text style={styles.heroTitle}>Learn IronVault properly.</Text>
        <Text style={styles.heroText}>
          A full guide for setup, workouts, splits, supersets, stats, PRs,
          machine brands, and backups.
        </Text>
        <View style={styles.heroMetaRow}>
          <Pill label="10 topics" />
          <Pill label="New user friendly" />
          <Pill label="Full manual" />
        </View>
      </View>

      <View style={styles.quickPathCard}>
        <View style={styles.quickPathHeader}>
          <Text style={styles.sectionEyebrow}>Recommended first setup</Text>
          <Text style={styles.quickPathHint}>Start here</Text>
        </View>

        {[
          [
            "Settings",
            "Choose units, rest timer, gyms, and default machine brands.",
          ],
          ["Templates", "Create reusable workouts for your routine."],
          [
            "Split Folder",
            "Organise templates into D1–D9 training days and rest days.",
          ],
          [
            "Active Split",
            "Choose which split appears on Home as Today’s Training.",
          ],
          [
            "Sync",
            "Back up workouts, templates, folders, exercises, gyms, and settings.",
          ],
        ].map(([label, description], index, arr) => (
          <View key={label}>
            <View style={styles.setupListRow}>
              <View style={styles.setupListBadge}>
                <Text style={styles.setupListBadgeText}>{index + 1}</Text>
              </View>
              <View style={styles.setupListTextBlock}>
                <Text style={styles.setupListTitle}>{label}</Text>
                <Text style={styles.setupListDescription}>{description}</Text>
              </View>
            </View>
            {index < arr.length - 1 && <View style={styles.setupListDivider} />}
          </View>
        ))}
      </View>

      <Text style={styles.sectionHeader}>Guide topics</Text>
      {guideTopics.map((topic) => (
        <TouchableOpacity
          key={topic.id}
          style={styles.topicCard}
          onPress={() => onOpenTopic(topic.id)}
          activeOpacity={0.84}
        >
          <View style={[styles.topicNumber, { borderColor: topic.accent }]}>
            <Text style={[styles.topicNumberText, { color: topic.accent }]}>
              {topic.number}
            </Text>
          </View>
          <View style={styles.topicTextBlock}>
            <View style={styles.topicTitleRow}>
              <Text style={styles.topicTitle}>{topic.title}</Text>
              <View style={styles.readTimePill}>
                <Text style={styles.readTimeText}>{topic.readTime}</Text>
              </View>
            </View>
            <Text style={styles.topicSubtitle}>{topic.subtitle}</Text>
            <Text style={styles.topicSummary}>{topic.summary}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={Colors.muted} />
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

function TopicPage({
  topic,
  topicIndex,
  topicCount,
  previousTopic,
  nextTopic,
  onPrevious,
  onNext,
}: {
  topic: Topic;
  topicIndex: number;
  topicCount: number;
  previousTopic: Topic | null;
  nextTopic: Topic | null;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const scrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    });
  }, [topic.id]);

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={styles.topicContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.topicHero, { borderColor: topic.accent }]}>
        <View
          style={[
            styles.topicHeroIcon,
            { backgroundColor: withAlpha(topic.accent, 0.16) },
          ]}
        >
          <Ionicons name={topic.icon} size={28} color={topic.accent} />
        </View>
        <Text style={styles.topicHeroNumber}>
          Topic {topicIndex + 1} of {topicCount}
        </Text>
        <Text style={styles.topicHeroTitle}>{topic.title}</Text>
        <Text style={styles.topicHeroSubtitle}>{topic.summary}</Text>
      </View>

      {topic.sections.map((section, index) => (
        <View
          style={styles.detailCard}
          key={`${topic.id}-${section.title}-${index}`}
        >
          <Text style={styles.detailCardTitle}>{section.title}</Text>

          {section.body?.map((paragraph: string, pIndex: number) => (
            <Text style={styles.paragraph} key={`body-${pIndex}`}>
              {paragraph}
            </Text>
          ))}

          {section.steps && <StepList steps={section.steps} />}
          {section.bullets && <BulletList bullets={section.bullets} />}
          {section.cards && <MiniCards cards={section.cards} />}
          {section.table && (
            <GuideTable rows={section.table} accent={topic.accent} />
          )}
          {section.callout && (
            <Callout text={section.callout} accent={topic.accent} />
          )}
        </View>
      ))}

      <View style={styles.topicNavCard}>
        <TouchableOpacity
          style={[
            styles.topicNavButton,
            !previousTopic && styles.topicNavButtonDisabled,
          ]}
          onPress={onPrevious}
          disabled={!previousTopic}
          activeOpacity={0.82}
        >
          <Ionicons
            name="chevron-back"
            size={18}
            color={previousTopic ? Colors.text : Colors.subtle}
          />
          <View style={styles.topicNavTextBlock}>
            <Text
              style={[
                styles.topicNavLabel,
                !previousTopic && styles.topicNavTextDisabled,
              ]}
            >
              Previous
            </Text>
            <Text
              style={[
                styles.topicNavTitle,
                !previousTopic && styles.topicNavTextDisabled,
              ]}
              numberOfLines={1}
            >
              {previousTopic ? previousTopic.title : "Start of guide"}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.topicNavButton,
            styles.topicNavButtonNext,
            !nextTopic && styles.topicNavButtonDisabled,
          ]}
          onPress={onNext}
          disabled={!nextTopic}
          activeOpacity={0.82}
        >
          <View style={[styles.topicNavTextBlock, { alignItems: "flex-end" }]}>
            <Text
              style={[
                styles.topicNavLabel,
                !nextTopic && styles.topicNavTextDisabled,
              ]}
            >
              Next
            </Text>
            <Text
              style={[
                styles.topicNavTitle,
                !nextTopic && styles.topicNavTextDisabled,
              ]}
              numberOfLines={1}
            >
              {nextTopic ? nextTopic.title : "End of guide"}
            </Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={nextTopic ? Colors.text : Colors.subtle}
          />
        </TouchableOpacity>
      </View>

      <View style={styles.endCard}>
        <Ionicons
          name="checkmark-circle-outline"
          size={24}
          color={Colors.green}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.endTitle}>You’re ready to use this feature.</Text>
          <Text style={styles.endText}>
            Return to the app and try the workflow once. The guide is always
            available again from Settings.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

function Pill({ label }: { label: string }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

function StepList({ steps }: { steps: string[] }) {
  return (
    <View style={styles.stepList}>
      {steps.map((step, index) => (
        <View style={styles.stepItem} key={step}>
          <View style={styles.stepBadge}>
            <Text style={styles.stepBadgeText}>{index + 1}</Text>
          </View>
          <Text style={styles.stepText}>{step}</Text>
        </View>
      ))}
    </View>
  );
}

function BulletList({ bullets }: { bullets: string[] }) {
  return (
    <View style={styles.bulletList}>
      {bullets.map((bullet) => (
        <View style={styles.bulletRow} key={bullet}>
          <View style={styles.bulletDot} />
          <Text style={styles.bulletText}>{bullet}</Text>
        </View>
      ))}
    </View>
  );
}

function MiniCards({ cards }: { cards: [string, string][] }) {
  return (
    <View style={styles.miniCardsWrap}>
      {cards.map(([title, body]) => (
        <View style={styles.miniCard} key={title}>
          <Text style={styles.miniCardTitle}>{title}</Text>
          <Text style={styles.miniCardText}>{body}</Text>
        </View>
      ))}
    </View>
  );
}

function GuideTable({
  rows,
  accent,
}: {
  rows: [string, string][];
  accent: string;
}) {
  return (
    <View style={styles.table}>
      {rows.map(([left, right], index) => (
        <View
          style={[
            styles.tableRow,
            index === rows.length - 1 && styles.tableRowLast,
          ]}
          key={`${left}-${right}-${index}`}
        >
          <View
            style={[styles.tableLeft, { borderColor: withAlpha(accent, 0.35) }]}
          >
            <Text style={[styles.tableLeftText, { color: accent }]}>
              {left}
            </Text>
          </View>
          <Text style={styles.tableRightText}>{right}</Text>
        </View>
      ))}
    </View>
  );
}

function Callout({ text, accent }: { text: string; accent: string }) {
  return (
    <View
      style={[
        styles.callout,
        {
          borderColor: withAlpha(accent, 0.35),
          backgroundColor: withAlpha(accent, 0.1),
        },
      ]}
    >
      <Ionicons name="information-circle-outline" size={20} color={accent} />
      <Text style={styles.calloutText}>{text}</Text>
    </View>
  );
}

function withAlpha(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  const bigint = parseInt(normalized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  topBar: {
    height: 58,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.card,
  },
  iconButtonPlaceholder: {
    width: 44,
    height: 44,
  },
  topBarTitle: {
    flex: 1,
    textAlign: "center",
    color: Colors.text,
    fontSize: 16,
    fontWeight: "900",
    marginHorizontal: 8,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 18,
  },
  topicContent: {
    padding: 20,
    paddingBottom: 18,
  },
  heroCard: {
    backgroundColor: Colors.card,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 22,
    marginBottom: 16,
    ...shadow(4),
  },
  heroIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.greenSoft,
    borderWidth: 1,
    borderColor: Colors.greenBorder,
    marginBottom: 18,
  },
  heroTitle: {
    color: Colors.text,
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: -0.8,
    marginBottom: 8,
  },
  heroText: {
    color: Colors.muted,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700",
  },
  heroMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 18,
    gap: 8,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: Colors.cardAlt,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
  },
  pillText: {
    color: Colors.text,
    fontSize: 11,
    fontWeight: "900",
  },
  quickPathCard: {
    backgroundColor: Colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    marginBottom: 24,
  },
  sectionEyebrow: {
    color: Colors.muted,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 12,
  },
  quickPathHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  quickPathHint: {
    color: Colors.green,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 12,
  },
  setupListRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
  },
  setupListBadge: {
    width: 36,
    height: 36,
    borderRadius: 14,
    backgroundColor: Colors.greenSoft,
    borderWidth: 1,
    borderColor: Colors.greenBorder,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  setupListBadgeText: {
    color: Colors.green,
    fontSize: 15,
    fontWeight: "900",
  },
  setupListTextBlock: {
    flex: 1,
  },
  setupListTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 3,
  },
  setupListDescription: {
    color: Colors.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  setupListDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginLeft: 48,
  },
  sectionHeader: {
    color: Colors.muted,
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1.1,
    marginBottom: 12,
  },
  topicCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    marginBottom: 12,
    gap: 12,
  },
  topicNumber: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    backgroundColor: Colors.surface,
  },
  topicNumberText: {
    fontSize: 13,
    fontWeight: "900",
  },
  topicTextBlock: {
    flex: 1,
  },
  topicTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 3,
    gap: 8,
  },
  topicTitle: {
    flex: 1,
    color: Colors.text,
    fontSize: 17,
    fontWeight: "900",
  },
  readTimePill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: Colors.surface,
  },
  readTimeText: {
    color: Colors.muted,
    fontSize: 10,
    fontWeight: "900",
  },
  topicSubtitle: {
    color: Colors.muted,
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 6,
  },
  topicSummary: {
    color: Colors.subtle,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  topicHero: {
    backgroundColor: Colors.card,
    borderRadius: 30,
    borderWidth: 1,
    padding: 22,
    marginBottom: 16,
  },
  topicHeroIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  topicHeroNumber: {
    color: Colors.muted,
    fontSize: 12,
    fontWeight: "900",
    marginBottom: 4,
  },
  topicHeroTitle: {
    color: Colors.text,
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -0.7,
    marginBottom: 8,
  },
  topicHeroSubtitle: {
    color: Colors.muted,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700",
  },
  detailCard: {
    backgroundColor: Colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 18,
    marginBottom: 14,
  },
  detailCardTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 12,
  },
  paragraph: {
    color: Colors.muted,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "700",
    marginBottom: 10,
  },
  stepList: {
    gap: 12,
  },
  stepItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.greenSoft,
    borderWidth: 1,
    borderColor: Colors.greenBorder,
  },
  stepBadgeText: {
    color: Colors.green,
    fontSize: 12,
    fontWeight: "900",
  },
  stepText: {
    flex: 1,
    color: Colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  bulletList: {
    gap: 10,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.green,
    marginTop: 7,
  },
  bulletText: {
    flex: 1,
    color: Colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  miniCardsWrap: {
    gap: 10,
  },
  miniCard: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
  },
  miniCardTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 5,
  },
  miniCardText: {
    color: Colors.muted,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
  },
  table: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "stretch",
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tableRowLast: {
    borderBottomWidth: 0,
  },
  tableLeft: {
    width: 94,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRightWidth: 1,
    backgroundColor: Colors.surface,
    justifyContent: "center",
  },
  tableLeftText: {
    fontSize: 13,
    fontWeight: "900",
  },
  tableRightText: {
    flex: 1,
    color: Colors.text,
    fontSize: 14,
    fontWeight: "800",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  callout: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
  },
  calloutText: {
    flex: 1,
    color: Colors.text,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "800",
  },
  topicNavCard: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  topicNavButton: {
    flex: 1,
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  topicNavButtonNext: {
    justifyContent: "flex-end",
  },
  topicNavButtonDisabled: {
    opacity: 0.45,
  },
  topicNavTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  topicNavLabel: {
    color: Colors.green,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 5,
  },
  topicNavTitle: {
    color: Colors.text,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "900",
  },
  topicNavTextDisabled: {
    color: Colors.subtle,
  },
  endCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: Colors.greenSoft,
    borderColor: Colors.greenBorder,
    borderWidth: 1,
    borderRadius: 22,
    padding: 16,
  },
  endTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 4,
  },
  endText: {
    color: Colors.muted,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
  },
});

function shadow(elevation: number) {
  return Platform.select({
    ios: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: elevation },
      shadowOpacity: 0.18,
      shadowRadius: elevation * 2,
    },
    android: {
      elevation,
    },
    default: {},
  });
}
