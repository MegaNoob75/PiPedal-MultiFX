export interface MultiFXThemeDefinition {
    name: string;
    author: string;
    version: number;
    colors: {
        background: string;
        panel: string;
        panelAlt: string;
        navigation: string;
        navigationText: string;
        navigationSurface: string;
        selected: string;
        selectedSurface: string;
        selectedText: string;
        text: string;
        muted: string;
        border: string;
        danger: string;
    };
}

export const BUILT_IN_THEMES: MultiFXThemeDefinition[] = [
    {
        name: "MultiFX Purple",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#0D0B12",
            panel: "#18151E",
            panelAlt: "#211D27",
            navigation: "#A770E4",
            navigationText: "#D8B4FE",
            navigationSurface: "#2B1E3B",
            selected: "#22D3EE",
            selectedSurface: "#083344",
            selectedText: "#ECFEFF",
            text: "#F5F3F7",
            muted: "#B7AFBF",
            border: "#42384D",
            danger: "#F87171"
        }
    },
    {
        name: "Midnight Blue",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#081018",
            panel: "#101B28",
            panelAlt: "#172536",
            navigation: "#60A5FA",
            navigationText: "#DBEAFE",
            navigationSurface: "#172A46",
            selected: "#22D3EE",
            selectedSurface: "#073344",
            selectedText: "#ECFEFF",
            text: "#F1F5F9",
            muted: "#94A3B8",
            border: "#334155",
            danger: "#FB7185"
        }
    },
    {
        name: "Amber Stage",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#110D07",
            panel: "#1E1710",
            panelAlt: "#2A2117",
            navigation: "#F59E0B",
            navigationText: "#FEF3C7",
            navigationSurface: "#3A290D",
            selected: "#FDE047",
            selectedSurface: "#3B3205",
            selectedText: "#FFFCE8",
            text: "#FFF7ED",
            muted: "#C7B59F",
            border: "#5A4631",
            danger: "#FB7185"
        }
    },
    {
        name: "Crimson Stage",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#12090C",
            panel: "#211116",
            panelAlt: "#301820",
            navigation: "#FB7185",
            navigationText: "#FFE4E6",
            navigationSurface: "#461823",
            selected: "#FBBF24",
            selectedSurface: "#422A05",
            selectedText: "#FFFBEB",
            text: "#FFF1F2",
            muted: "#C8A8AF",
            border: "#5C303A",
            danger: "#F43F5E"
        }
    },
    {
        name: "High Contrast",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#000000",
            panel: "#101010",
            panelAlt: "#1B1B1B",
            navigation: "#FFFF00",
            navigationText: "#000000",
            navigationSurface: "#807600",
            selected: "#00FFFF",
            selectedSurface: "#005A5A",
            selectedText: "#FFFFFF",
            text: "#FFFFFF",
            muted: "#D0D0D0",
            border: "#FFFFFF",
            danger: "#FF4D4D"
        }
    },
    {
        name: "Emerald Stage",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#07110D",
            panel: "#0E1D16",
            panelAlt: "#15281E",
            navigation: "#34D399",
            navigationText: "#D1FAE5",
            navigationSurface: "#123729",
            selected: "#67E8F9",
            selectedSurface: "#083344",
            selectedText: "#ECFEFF",
            text: "#F0FDF4",
            muted: "#9DB8A9",
            border: "#2F5142",
            danger: "#FB7185"
        }
    },
    {
        name: "Neon Arcade",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#08070F",
            panel: "#141126",
            panelAlt: "#1D1835",
            navigation: "#E879F9",
            navigationText: "#FAE8FF",
            navigationSurface: "#3B1747",
            selected: "#22D3EE",
            selectedSurface: "#083344",
            selectedText: "#ECFEFF",
            text: "#FDF4FF",
            muted: "#BFA9C8",
            border: "#51365B",
            danger: "#FF5C8A"
        }
    },
    {
        name: "Ocean Drive",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#061116",
            panel: "#0D2028",
            panelAlt: "#14303A",
            navigation: "#38BDF8",
            navigationText: "#E0F2FE",
            navigationSurface: "#123A50",
            selected: "#2DD4BF",
            selectedSurface: "#073F3B",
            selectedText: "#ECFEFF",
            text: "#F0FDFA",
            muted: "#9EBCC0",
            border: "#31515A",
            danger: "#FB7185"
        }
    },
    {
        name: "Cyber Lime",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#091006",
            panel: "#141D10",
            panelAlt: "#1E2A17",
            navigation: "#A3E635",
            navigationText: "#F7FEE7",
            navigationSurface: "#334A16",
            selected: "#22D3EE",
            selectedSurface: "#083344",
            selectedText: "#ECFEFF",
            text: "#F7FEE7",
            muted: "#A9B99A",
            border: "#465A34",
            danger: "#FB7185"
        }
    },
    {
        name: "Sunset",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#140A0E",
            panel: "#24121A",
            panelAlt: "#321823",
            navigation: "#FB7185",
            navigationText: "#FFE4E6",
            navigationSurface: "#4A1828",
            selected: "#FB923C",
            selectedSurface: "#4A2410",
            selectedText: "#FFF7ED",
            text: "#FFF1F2",
            muted: "#C9A5AA",
            border: "#653443",
            danger: "#F43F5E"
        }
    },
    {
        name: "Violet Night",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#0B0814",
            panel: "#171123",
            panelAlt: "#21182F",
            navigation: "#8B5CF6",
            navigationText: "#EDE9FE",
            navigationSurface: "#30205A",
            selected: "#C084FC",
            selectedSurface: "#3B1261",
            selectedText: "#FAF5FF",
            text: "#F5F3FF",
            muted: "#B3A7C8",
            border: "#493A63",
            danger: "#FB7185"
        }
    },
    {
        name: "Deep Teal",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#061111",
            panel: "#0D1C1C",
            panelAlt: "#142727",
            navigation: "#2DD4BF",
            navigationText: "#CCFBF1",
            navigationSurface: "#123C38",
            selected: "#67E8F9",
            selectedSurface: "#0B3A43",
            selectedText: "#ECFEFF",
            text: "#F0FDFA",
            muted: "#9AB7B3",
            border: "#31504D",
            danger: "#FB7185"
        }
    },
    {
        name: "Ice Blue",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#071016",
            panel: "#101C26",
            panelAlt: "#192A37",
            navigation: "#7DD3FC",
            navigationText: "#E0F2FE",
            navigationSurface: "#19364A",
            selected: "#A5F3FC",
            selectedSurface: "#164E63",
            selectedText: "#ECFEFF",
            text: "#F0F9FF",
            muted: "#A4B5C2",
            border: "#3D5668",
            danger: "#FB7185"
        }
    },
    {
        name: "Royal Gold",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#100C08",
            panel: "#1C1710",
            panelAlt: "#292116",
            navigation: "#C084FC",
            navigationText: "#F3E8FF",
            navigationSurface: "#39204C",
            selected: "#FACC15",
            selectedSurface: "#4A3A05",
            selectedText: "#FEFCE8",
            text: "#FFF7ED",
            muted: "#BEB09A",
            border: "#51442E",
            danger: "#FB7185"
        }
    },
    {
        name: "Copper",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#120B07",
            panel: "#21150F",
            panelAlt: "#302017",
            navigation: "#D97706",
            navigationText: "#FFEDD5",
            navigationSurface: "#4A2B10",
            selected: "#FDBA74",
            selectedSurface: "#4A250E",
            selectedText: "#FFF7ED",
            text: "#FFF7ED",
            muted: "#C4AA96",
            border: "#5A3D2B",
            danger: "#FB7185"
        }
    },
    {
        name: "Graphite",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#090A0C",
            panel: "#15171B",
            panelAlt: "#202329",
            navigation: "#94A3B8",
            navigationText: "#F1F5F9",
            navigationSurface: "#30343B",
            selected: "#22D3EE",
            selectedSurface: "#083344",
            selectedText: "#ECFEFF",
            text: "#F8FAFC",
            muted: "#A3AAB5",
            border: "#3D424C",
            danger: "#FB7185"
        }
    },
    {
        name: "Slate Purple",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#0C0D12",
            panel: "#181A23",
            panelAlt: "#232633",
            navigation: "#818CF8",
            navigationText: "#E0E7FF",
            navigationSurface: "#2F3260",
            selected: "#22D3EE",
            selectedSurface: "#083344",
            selectedText: "#ECFEFF",
            text: "#F8FAFC",
            muted: "#A5AABE",
            border: "#3F4356",
            danger: "#FB7185"
        }
    },
    {
        name: "Hot Pink",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#130912",
            panel: "#221020",
            panelAlt: "#32172E",
            navigation: "#F472B6",
            navigationText: "#FCE7F3",
            navigationSurface: "#4A183A",
            selected: "#22D3EE",
            selectedSurface: "#083344",
            selectedText: "#ECFEFF",
            text: "#FDF2F8",
            muted: "#C6A5BA",
            border: "#623650",
            danger: "#FB7185"
        }
    },
    {
        name: "Retro Green",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#050B06",
            panel: "#0C160D",
            panelAlt: "#132216",
            navigation: "#4ADE80",
            navigationText: "#DCFCE7",
            navigationSurface: "#174429",
            selected: "#FACC15",
            selectedSurface: "#493E06",
            selectedText: "#FEFCE8",
            text: "#F0FDF4",
            muted: "#9FB4A2",
            border: "#315038",
            danger: "#FB7185"
        }
    },
    {
        name: "Synthwave",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#0A0714",
            panel: "#171025",
            panelAlt: "#24153A",
            navigation: "#C026D3",
            navigationText: "#FAE8FF",
            navigationSurface: "#461456",
            selected: "#06B6D4",
            selectedSurface: "#083344",
            selectedText: "#ECFEFF",
            text: "#FAF5FF",
            muted: "#B8A7C8",
            border: "#4B3761",
            danger: "#FB7185"
        }
    },
    {
        name: "Solar",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#120F05",
            panel: "#211B0B",
            panelAlt: "#302715",
            navigation: "#EAB308",
            navigationText: "#FEF9C3",
            navigationSurface: "#493B06",
            selected: "#F97316",
            selectedSurface: "#4A2306",
            selectedText: "#FFF7ED",
            text: "#FEFCE8",
            muted: "#BEB28C",
            border: "#554A29",
            danger: "#EF4444"
        }
    },
    {
        name: "Arctic",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#071115",
            panel: "#0F1C22",
            panelAlt: "#172A33",
            navigation: "#38BDF8",
            navigationText: "#E0F2FE",
            navigationSurface: "#12384B",
            selected: "#E0F2FE",
            selectedSurface: "#164E63",
            selectedText: "#FFFFFF",
            text: "#F8FAFC",
            muted: "#AFC3CC",
            border: "#3B5662",
            danger: "#FB7185"
        }
    },
    {
        name: "Purple Rain",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#0E0912",
            panel: "#1B1022",
            panelAlt: "#291631",
            navigation: "#A855F7",
            navigationText: "#F3E8FF",
            navigationSurface: "#391451",
            selected: "#38BDF8",
            selectedSurface: "#123A52",
            selectedText: "#F0F9FF",
            text: "#FAF5FF",
            muted: "#B9A8C4",
            border: "#51365D",
            danger: "#FB7185"
        }
    },
    {
        name: "Orange Crush",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#130B05",
            panel: "#22140B",
            panelAlt: "#321F10",
            navigation: "#F97316",
            navigationText: "#FFEDD5",
            navigationSurface: "#4B250A",
            selected: "#FACC15",
            selectedSurface: "#4A3B05",
            selectedText: "#FEFCE8",
            text: "#FFF7ED",
            muted: "#C7AA8D",
            border: "#614126",
            danger: "#EF4444"
        }
    },
    {
        name: "Mono Light",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#E9E9EC",
            panel: "#FFFFFF",
            panelAlt: "#DADAE0",
            navigation: "#5B21B6",
            navigationText: "#2E1065",
            navigationSurface: "#DDD6FE",
            selected: "#0369A1",
            selectedSurface: "#CFFAFE",
            selectedText: "#083344",
            text: "#111827",
            muted: "#4B5563",
            border: "#A7A7B1",
            danger: "#B91C1C"
        }
    },
    {
        name: "Blackout",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#000000",
            panel: "#080808",
            panelAlt: "#111111",
            navigation: "#A78BFA",
            navigationText: "#EDE9FE",
            navigationSurface: "#24163D",
            selected: "#22D3EE",
            selectedSurface: "#052E35",
            selectedText: "#ECFEFF",
            text: "#FAFAFA",
            muted: "#A3A3A3",
            border: "#292929",
            danger: "#EF4444"
        }
    },
    {
        name: "Tube Glow",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#100805",
            panel: "#21110A",
            panelAlt: "#321A0D",
            navigation: "#F97316",
            navigationText: "#FFEDD5",
            navigationSurface: "#4A250A",
            selected: "#FBBF24",
            selectedSurface: "#4A3505",
            selectedText: "#FFFBEB",
            text: "#FFF7ED",
            muted: "#C7A58C",
            border: "#633A21",
            danger: "#EF4444"
        }
    },
    {
        name: "British Stack",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#090909",
            panel: "#171717",
            panelAlt: "#242424",
            navigation: "#DC2626",
            navigationText: "#FEE2E2",
            navigationSurface: "#451A1A",
            selected: "#F59E0B",
            selectedSurface: "#422006",
            selectedText: "#FFFBEB",
            text: "#F5F5F5",
            muted: "#A3A3A3",
            border: "#404040",
            danger: "#F87171"
        }
    },
    {
        name: "Boutique Blue",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#07101C",
            panel: "#0E1D31",
            panelAlt: "#162A43",
            navigation: "#3B82F6",
            navigationText: "#DBEAFE",
            navigationSurface: "#173B70",
            selected: "#F59E0B",
            selectedSurface: "#453105",
            selectedText: "#FFFBEB",
            text: "#EFF6FF",
            muted: "#9DB1C9",
            border: "#34506F",
            danger: "#FB7185"
        }
    },
    {
        name: "Vintage Cream",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#E9DFC7",
            panel: "#F5EBD6",
            panelAlt: "#D9C9A8",
            navigation: "#7C2D12",
            navigationText: "#FFF7ED",
            navigationSurface: "#CFAE87",
            selected: "#0F766E",
            selectedSurface: "#CCFBF1",
            selectedText: "#134E4A",
            text: "#2B2118",
            muted: "#685B49",
            border: "#A79478",
            danger: "#B91C1C"
        }
    },
    {
        name: "Brownface",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#160D08",
            panel: "#2A1A10",
            panelAlt: "#3B291A",
            navigation: "#C08457",
            navigationText: "#FFF1DC",
            navigationSurface: "#56361D",
            selected: "#EAB308",
            selectedSurface: "#473A05",
            selectedText: "#FEFCE8",
            text: "#FFF7ED",
            muted: "#BDA38C",
            border: "#634936",
            danger: "#FB7185"
        }
    },
    {
        name: "Seafoam",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#071211",
            panel: "#102421",
            panelAlt: "#17332F",
            navigation: "#2DD4BF",
            navigationText: "#CCFBF1",
            navigationSurface: "#14453F",
            selected: "#F472B6",
            selectedSurface: "#4A1936",
            selectedText: "#FDF2F8",
            text: "#F0FDFA",
            muted: "#9EBAB4",
            border: "#345A54",
            danger: "#FB7185"
        }
    },
    {
        name: "Surf Green",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#08130E",
            panel: "#10251A",
            panelAlt: "#173623",
            navigation: "#4ADE80",
            navigationText: "#DCFCE7",
            navigationSurface: "#17452A",
            selected: "#FDE047",
            selectedSurface: "#443B08",
            selectedText: "#FEFCE8",
            text: "#F0FDF4",
            muted: "#A4B9AA",
            border: "#375541",
            danger: "#FB7185"
        }
    },
    {
        name: "Lavender Fog",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#100D17",
            panel: "#1D1828",
            panelAlt: "#2A2338",
            navigation: "#C4B5FD",
            navigationText: "#F5F3FF",
            navigationSurface: "#3A3153",
            selected: "#67E8F9",
            selectedSurface: "#123B45",
            selectedText: "#ECFEFF",
            text: "#FAF5FF",
            muted: "#BDB3CC",
            border: "#514867",
            danger: "#FB7185"
        }
    },
    {
        name: "Magma",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#160704",
            panel: "#2A0D07",
            panelAlt: "#3C140B",
            navigation: "#F97316",
            navigationText: "#FFEDD5",
            navigationSurface: "#5A210B",
            selected: "#EF4444",
            selectedSurface: "#4C0D0D",
            selectedText: "#FEF2F2",
            text: "#FFF7ED",
            muted: "#C7A092",
            border: "#6A3024",
            danger: "#FACC15"
        }
    },
    {
        name: "Electric Blue",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#050B16",
            panel: "#0B1730",
            panelAlt: "#102247",
            navigation: "#2563EB",
            navigationText: "#DBEAFE",
            navigationSurface: "#163A78",
            selected: "#22D3EE",
            selectedSurface: "#083344",
            selectedText: "#ECFEFF",
            text: "#EFF6FF",
            muted: "#93A9C9",
            border: "#2D4E78",
            danger: "#FB7185"
        }
    },
    {
        name: "Laser Green",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#030B07",
            panel: "#09170E",
            panelAlt: "#102617",
            navigation: "#22C55E",
            navigationText: "#DCFCE7",
            navigationSurface: "#0F4221",
            selected: "#A3E635",
            selectedSurface: "#2C450D",
            selectedText: "#F7FEE7",
            text: "#F0FDF4",
            muted: "#8FB69D",
            border: "#28553A",
            danger: "#FB7185"
        }
    },
    {
        name: "Acid Purple",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#0D0712",
            panel: "#1C0E27",
            panelAlt: "#2A123B",
            navigation: "#D946EF",
            navigationText: "#FAE8FF",
            navigationSurface: "#4B1455",
            selected: "#A3E635",
            selectedSurface: "#2F460D",
            selectedText: "#F7FEE7",
            text: "#FDF4FF",
            muted: "#BAA5C7",
            border: "#593369",
            danger: "#FB7185"
        }
    },
    {
        name: "Cherry Cola",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#12070A",
            panel: "#241015",
            panelAlt: "#341820",
            navigation: "#BE123C",
            navigationText: "#FFE4E6",
            navigationSurface: "#4B101F",
            selected: "#FB7185",
            selectedSurface: "#4B1320",
            selectedText: "#FFF1F2",
            text: "#FFF1F2",
            muted: "#C6A2AA",
            border: "#5C3038",
            danger: "#F59E0B"
        }
    },
    {
        name: "Tangerine",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#160C04",
            panel: "#281508",
            panelAlt: "#3B210D",
            navigation: "#FB923C",
            navigationText: "#FFEDD5",
            navigationSurface: "#572D0A",
            selected: "#FDE047",
            selectedSurface: "#443B08",
            selectedText: "#FEFCE8",
            text: "#FFF7ED",
            muted: "#C8A78D",
            border: "#654326",
            danger: "#EF4444"
        }
    },
    {
        name: "Mint Chocolate",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#0C110D",
            panel: "#172018",
            panelAlt: "#223026",
            navigation: "#34D399",
            navigationText: "#D1FAE5",
            navigationSurface: "#164632",
            selected: "#A78BFA",
            selectedSurface: "#30254E",
            selectedText: "#F5F3FF",
            text: "#F0FDF4",
            muted: "#A5B5A7",
            border: "#405343",
            danger: "#FB7185"
        }
    },
    {
        name: "Blue Steel",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#080B10",
            panel: "#121923",
            panelAlt: "#1C2734",
            navigation: "#64748B",
            navigationText: "#F1F5F9",
            navigationSurface: "#2C3848",
            selected: "#38BDF8",
            selectedSurface: "#12394C",
            selectedText: "#F0F9FF",
            text: "#F8FAFC",
            muted: "#AAB3BE",
            border: "#3B4655",
            danger: "#FB7185"
        }
    },
    {
        name: "Gunmetal",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#07090A",
            panel: "#101416",
            panelAlt: "#1A2023",
            navigation: "#71717A",
            navigationText: "#F4F4F5",
            navigationSurface: "#2D3338",
            selected: "#22D3EE",
            selectedSurface: "#083344",
            selectedText: "#ECFEFF",
            text: "#FAFAFA",
            muted: "#A1A1AA",
            border: "#353B40",
            danger: "#F87171"
        }
    },
    {
        name: "Goldtop",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#120E05",
            panel: "#211A0B",
            panelAlt: "#302714",
            navigation: "#CA8A04",
            navigationText: "#FEF9C3",
            navigationSurface: "#493B06",
            selected: "#FDE047",
            selectedSurface: "#4A3C05",
            selectedText: "#FEFCE8",
            text: "#FFF7ED",
            muted: "#C1B08F",
            border: "#584B2D",
            danger: "#EF4444"
        }
    },
    {
        name: "Silverface",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#0B0D10",
            panel: "#171B21",
            panelAlt: "#222833",
            navigation: "#CBD5E1",
            navigationText: "#0F172A",
            navigationSurface: "#526273",
            selected: "#60A5FA",
            selectedSurface: "#172A46",
            selectedText: "#EFF6FF",
            text: "#F8FAFC",
            muted: "#B4BDC8",
            border: "#475569",
            danger: "#FB7185"
        }
    },
    {
        name: "Redline",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#110507",
            panel: "#230A0E",
            panelAlt: "#340E15",
            navigation: "#EF4444",
            navigationText: "#FEE2E2",
            navigationSurface: "#4D1519",
            selected: "#22D3EE",
            selectedSurface: "#083344",
            selectedText: "#ECFEFF",
            text: "#FFF1F2",
            muted: "#C8A1A8",
            border: "#5D2932",
            danger: "#FACC15"
        }
    },
    {
        name: "Night Vision",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#020806",
            panel: "#07140E",
            panelAlt: "#0D2217",
            navigation: "#16A34A",
            navigationText: "#DCFCE7",
            navigationSurface: "#0F3D21",
            selected: "#86EFAC",
            selectedSurface: "#154A2B",
            selectedText: "#F0FDF4",
            text: "#DCFCE7",
            muted: "#7EA18B",
            border: "#254C34",
            danger: "#F87171"
        }
    },
    {
        name: "Ultraviolet",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#09040E",
            panel: "#160B20",
            panelAlt: "#241032",
            navigation: "#7C3AED",
            navigationText: "#EDE9FE",
            navigationSurface: "#35165A",
            selected: "#F472B6",
            selectedSurface: "#471632",
            selectedText: "#FDF2F8",
            text: "#FAF5FF",
            muted: "#B49DC5",
            border: "#4D2C63",
            danger: "#FB7185"
        }
    },
    {
        name: "Candy Apple",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#120507",
            panel: "#240A0C",
            panelAlt: "#371014",
            navigation: "#DC2626",
            navigationText: "#FEE2E2",
            navigationSurface: "#4E1215",
            selected: "#F472B6",
            selectedSurface: "#4B1836",
            selectedText: "#FDF2F8",
            text: "#FFF1F2",
            muted: "#C9A1A7",
            border: "#632B32",
            danger: "#FACC15"
        }
    },
    {
        name: "Desert Sand",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#19140D",
            panel: "#2A2319",
            panelAlt: "#3B3224",
            navigation: "#D6A85F",
            navigationText: "#FFF7ED",
            navigationSurface: "#5A4527",
            selected: "#60A5FA",
            selectedSurface: "#183454",
            selectedText: "#EFF6FF",
            text: "#FFF7ED",
            muted: "#C8BDAA",
            border: "#655944",
            danger: "#EF4444"
        }
    },
    {
        name: "Forest",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#061008",
            panel: "#0D1C11",
            panelAlt: "#142A1A",
            navigation: "#22C55E",
            navigationText: "#DCFCE7",
            navigationSurface: "#0E4022",
            selected: "#F59E0B",
            selectedSurface: "#463006",
            selectedText: "#FFFBEB",
            text: "#F0FDF4",
            muted: "#9DB3A2",
            border: "#31503A",
            danger: "#FB7185"
        }
    },
    {
        name: "Deep Space",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#03050B",
            panel: "#090D19",
            panelAlt: "#10162A",
            navigation: "#6366F1",
            navigationText: "#E0E7FF",
            navigationSurface: "#24265C",
            selected: "#22D3EE",
            selectedSurface: "#083344",
            selectedText: "#ECFEFF",
            text: "#EEF2FF",
            muted: "#979FB8",
            border: "#2B3250",
            danger: "#FB7185"
        }
    },
    {
        name: "Aurora",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#071014",
            panel: "#0E1E23",
            panelAlt: "#153038",
            navigation: "#14B8A6",
            navigationText: "#CCFBF1",
            navigationSurface: "#12423C",
            selected: "#A78BFA",
            selectedSurface: "#30254E",
            selectedText: "#F5F3FF",
            text: "#F0FDFA",
            muted: "#9CB6B8",
            border: "#31525A",
            danger: "#FB7185"
        }
    },
    {
        name: "Plasma",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#100615",
            panel: "#210D2A",
            panelAlt: "#321440",
            navigation: "#E879F9",
            navigationText: "#FAE8FF",
            navigationSurface: "#4A175E",
            selected: "#FB923C",
            selectedSurface: "#4A250E",
            selectedText: "#FFF7ED",
            text: "#FDF4FF",
            muted: "#C0A3C9",
            border: "#5A326A",
            danger: "#F87171"
        }
    },
    {
        name: "Terminal Amber",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#080603",
            panel: "#151006",
            panelAlt: "#241A08",
            navigation: "#F59E0B",
            navigationText: "#FEF3C7",
            navigationSurface: "#432E06",
            selected: "#FDBA74",
            selectedSurface: "#4A260D",
            selectedText: "#FFF7ED",
            text: "#FEF3C7",
            muted: "#BFA36E",
            border: "#4D3A18",
            danger: "#EF4444"
        }
    },
    {
        name: "Terminal Green",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#020805",
            panel: "#07150B",
            panelAlt: "#0C2412",
            navigation: "#22C55E",
            navigationText: "#DCFCE7",
            navigationSurface: "#0D3D20",
            selected: "#86EFAC",
            selectedSurface: "#134B29",
            selectedText: "#F0FDF4",
            text: "#DCFCE7",
            muted: "#84AA91",
            border: "#245238",
            danger: "#F87171"
        }
    },
    {
        name: "Studio Dark",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#0B0B0D",
            panel: "#171719",
            panelAlt: "#232326",
            navigation: "#A3A3A3",
            navigationText: "#F5F5F5",
            navigationSurface: "#333338",
            selected: "#60A5FA",
            selectedSurface: "#172A46",
            selectedText: "#EFF6FF",
            text: "#FAFAFA",
            muted: "#A8A8AE",
            border: "#414147",
            danger: "#F87171"
        }
    },
    {
        name: "Studio Warm",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#120F0C",
            panel: "#211B17",
            panelAlt: "#302821",
            navigation: "#C08457",
            navigationText: "#FFF7ED",
            navigationSurface: "#4B3425",
            selected: "#60A5FA",
            selectedSurface: "#193553",
            selectedText: "#EFF6FF",
            text: "#FFF7ED",
            muted: "#BFAE9F",
            border: "#55483C",
            danger: "#FB7185"
        }
    },
    {
        name: "Stage White",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#D9DBDE",
            panel: "#F8FAFC",
            panelAlt: "#C8CDD2",
            navigation: "#6D28D9",
            navigationText: "#F5F3FF",
            navigationSurface: "#DDD6FE",
            selected: "#0891B2",
            selectedSurface: "#CFFAFE",
            selectedText: "#164E63",
            text: "#111827",
            muted: "#475569",
            border: "#94A3B8",
            danger: "#B91C1C"
        }
    },
    {
        name: "Creamsicle",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#FFF0DD",
            panel: "#FFF8ED",
            panelAlt: "#EFD7BD",
            navigation: "#EA580C",
            navigationText: "#FFF7ED",
            navigationSurface: "#FED7AA",
            selected: "#0891B2",
            selectedSurface: "#CFFAFE",
            selectedText: "#164E63",
            text: "#3A2416",
            muted: "#765B47",
            border: "#C7A98B",
            danger: "#B91C1C"
        }
    },
    {
        name: "Pastel Night",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#11101A",
            panel: "#1E1B2B",
            panelAlt: "#2A2639",
            navigation: "#C4B5FD",
            navigationText: "#F5F3FF",
            navigationSurface: "#3E365A",
            selected: "#F9A8D4",
            selectedSurface: "#4A1E38",
            selectedText: "#FDF2F8",
            text: "#FAF5FF",
            muted: "#BCB4C9",
            border: "#4A435B",
            danger: "#FB7185"
        }
    },
    {
        name: "Nordic",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#0A1014",
            panel: "#121C22",
            panelAlt: "#1B2931",
            navigation: "#88C0D0",
            navigationText: "#E5E9F0",
            navigationSurface: "#27434D",
            selected: "#A3BE8C",
            selectedSurface: "#33422B",
            selectedText: "#F0FDF4",
            text: "#ECEFF4",
            muted: "#AAB7C0",
            border: "#3B4C55",
            danger: "#BF616A"
        }
    },
    {
        name: "Dracula",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#0B0A11",
            panel: "#171522",
            panelAlt: "#242033",
            navigation: "#BD93F9",
            navigationText: "#F8F8F2",
            navigationSurface: "#3D285F",
            selected: "#8BE9FD",
            selectedSurface: "#164A55",
            selectedText: "#F8F8F2",
            text: "#F8F8F2",
            muted: "#AFA9BD",
            border: "#4B425F",
            danger: "#FF5555"
        }
    },
    {
        name: "Solarized Dark",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#002B36",
            panel: "#073642",
            panelAlt: "#0D4652",
            navigation: "#B58900",
            navigationText: "#FDF6E3",
            navigationSurface: "#4B3C08",
            selected: "#2AA198",
            selectedSurface: "#0B4B49",
            selectedText: "#E0F7F4",
            text: "#EEE8D5",
            muted: "#93A1A1",
            border: "#586E75",
            danger: "#DC322F"
        }
    },
    {
        name: "Solarized Light",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#FDF6E3",
            panel: "#EEE8D5",
            panelAlt: "#E4DCC8",
            navigation: "#6C71C4",
            navigationText: "#FDF6E3",
            navigationSurface: "#D8D3ED",
            selected: "#2AA198",
            selectedSurface: "#C8EEE9",
            selectedText: "#073642",
            text: "#073642",
            muted: "#657B83",
            border: "#93A1A1",
            danger: "#DC322F"
        }
    },
    {
        name: "Rose Gold",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#140D0F",
            panel: "#24181C",
            panelAlt: "#342328",
            navigation: "#E8A0A8",
            navigationText: "#FFF1F2",
            navigationSurface: "#53363C",
            selected: "#FBBF24",
            selectedSurface: "#4A3A06",
            selectedText: "#FFFBEB",
            text: "#FFF1F2",
            muted: "#C7A8AD",
            border: "#60444A",
            danger: "#F87171"
        }
    },
    {
        name: "Champagne",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#17130B",
            panel: "#272116",
            panelAlt: "#39301F",
            navigation: "#D6B875",
            navigationText: "#FFF7ED",
            navigationSurface: "#5A4728",
            selected: "#A78BFA",
            selectedSurface: "#31284E",
            selectedText: "#F5F3FF",
            text: "#FFF7ED",
            muted: "#C7B99D",
            border: "#65583A",
            danger: "#EF4444"
        }
    },
    {
        name: "Frosted Mint",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#E9F8F3",
            panel: "#FFFFFF",
            panelAlt: "#D9EEE7",
            navigation: "#0F766E",
            navigationText: "#F0FDFA",
            navigationSurface: "#A7F3D0",
            selected: "#2563EB",
            selectedSurface: "#DBEAFE",
            selectedText: "#1E3A8A",
            text: "#102A26",
            muted: "#4B6861",
            border: "#9FC1B7",
            danger: "#B91C1C"
        }
    },
    {
        name: "Cloud",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#E8EDF3",
            panel: "#FFFFFF",
            panelAlt: "#D9E1EA",
            navigation: "#475569",
            navigationText: "#F8FAFC",
            navigationSurface: "#CBD5E1",
            selected: "#0284C7",
            selectedSurface: "#E0F2FE",
            selectedText: "#0C4A6E",
            text: "#0F172A",
            muted: "#52606D",
            border: "#A8B4C1",
            danger: "#B91C1C"
        }
    },

    {
        name: "Ocean Glass",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#123B4A",
            panel: "#1B5668",
            panelAlt: "#246C7D",
            navigation: "#F0A85B",
            navigationText: "#5A3016",
            navigationSurface: "#D98546",
            selected: "#8BE0D0",
            selectedSurface: "#287A73",
            selectedText: "#173E3A",
            text: "#D7F4E8",
            muted: "#A8D7CF",
            border: "#63B6C7",
            danger: "#F08A78"
        }
    },
    {
        name: "Burgundy Velvet",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#4A1828",
            panel: "#6B2439",
            panelAlt: "#84334B",
            navigation: "#E7A65A",
            navigationText: "#5A2C12",
            navigationSurface: "#C77A3E",
            selected: "#8FD3C8",
            selectedSurface: "#2E726C",
            selectedText: "#173C38",
            text: "#F3C6B8",
            muted: "#D39A94",
            border: "#C96A7D",
            danger: "#F09A7E"
        }
    },
    {
        name: "Moss & Brass",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#32462C",
            panel: "#465E3A",
            panelAlt: "#587147",
            navigation: "#D6B35E",
            navigationText: "#4A3816",
            navigationSurface: "#B18E42",
            selected: "#7FC6B0",
            selectedSurface: "#326E5C",
            selectedText: "#173A31",
            text: "#F0D9A3",
            muted: "#C8BC8C",
            border: "#B89B55",
            danger: "#D9796E"
        }
    },
    {
        name: "Cobalt Copper",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#173D73",
            panel: "#24558E",
            panelAlt: "#2F68A3",
            navigation: "#D98A52",
            navigationText: "#5B2F17",
            navigationSurface: "#B96D3A",
            selected: "#83D3C5",
            selectedSurface: "#27756D",
            selectedText: "#173C38",
            text: "#F0C7A1",
            muted: "#C6B39D",
            border: "#C97B43",
            danger: "#E57973"
        }
    },
    {
        name: "Aubergine Sage",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#432854",
            panel: "#5B396C",
            panelAlt: "#704A80",
            navigation: "#B9C77B",
            navigationText: "#344022",
            navigationSurface: "#8FA159",
            selected: "#8CCFC2",
            selectedSurface: "#34766E",
            selectedText: "#193E39",
            text: "#CFE3C1",
            muted: "#AEC09F",
            border: "#8AAE79",
            danger: "#E27C83"
        }
    },
    {
        name: "Terracotta Sky",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#7A3E2F",
            panel: "#96513F",
            panelAlt: "#AE6650",
            navigation: "#79B4D2",
            navigationText: "#24495C",
            navigationSurface: "#5D98B6",
            selected: "#E7C66D",
            selectedSurface: "#9B7C2E",
            selectedText: "#4B3B13",
            text: "#CBE4F0",
            muted: "#ACCAD6",
            border: "#72A7C2",
            danger: "#E57373"
        }
    },
    {
        name: "Peacock Gold",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#075B63",
            panel: "#0B747B",
            panelAlt: "#118B8F",
            navigation: "#E1B74D",
            navigationText: "#513D11",
            navigationSurface: "#BE9335",
            selected: "#D989B6",
            selectedSurface: "#8C3E67",
            selectedText: "#4A2036",
            text: "#F0D27A",
            muted: "#C8B968",
            border: "#D1A83F",
            danger: "#E97A70"
        }
    },
    {
        name: "Denim Rose",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#334E68",
            panel: "#456783",
            panelAlt: "#587C98",
            navigation: "#D58CA5",
            navigationText: "#5B2D3C",
            navigationSurface: "#B86F88",
            selected: "#E8C56D",
            selectedSurface: "#9B7C2E",
            selectedText: "#493A13",
            text: "#E9C3CF",
            muted: "#C8A8B3",
            border: "#B37B91",
            danger: "#E27474"
        }
    },
    {
        name: "Plum & Apricot",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#59305E",
            panel: "#744078",
            panelAlt: "#8B518D",
            navigation: "#E9A66F",
            navigationText: "#60341D",
            navigationSurface: "#C78354",
            selected: "#8FD0C0",
            selectedSurface: "#377669",
            selectedText: "#193E36",
            text: "#F1C8A7",
            muted: "#D3AA92",
            border: "#D18D72",
            danger: "#E87B78"
        }
    },
    {
        name: "Lagoon Coral",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#17636A",
            panel: "#237B80",
            panelAlt: "#329297",
            navigation: "#ED8D73",
            navigationText: "#653126",
            navigationSurface: "#CA6953",
            selected: "#E5C45F",
            selectedSurface: "#987C25",
            selectedText: "#493A10",
            text: "#BFE7D5",
            muted: "#9CCDBD",
            border: "#69B7A6",
            danger: "#E66E72"
        }
    },
    {
        name: "Olive Clay",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#59613A",
            panel: "#70794B",
            panelAlt: "#858D5D",
            navigation: "#CF7E5F",
            navigationText: "#572D20",
            navigationSurface: "#AD6248",
            selected: "#78B9C7",
            selectedSurface: "#3B7784",
            selectedText: "#183D45",
            text: "#E6D39B",
            muted: "#C5B783",
            border: "#B59C5E",
            danger: "#D96E68"
        }
    },
    {
        name: "Indigo Mint",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#343A7A",
            panel: "#484F94",
            panelAlt: "#5C63A8",
            navigation: "#84CDB7",
            navigationText: "#285348",
            navigationSurface: "#63AB97",
            selected: "#E4B768",
            selectedSurface: "#9B7130",
            selectedText: "#4A3414",
            text: "#C8E8DA",
            muted: "#A9CBBE",
            border: "#79B7A6",
            danger: "#E77B84"
        }
    },
    {
        name: "Raspberry Cream",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#7B2E52",
            panel: "#984064",
            panelAlt: "#AF5578",
            navigation: "#E2B665",
            navigationText: "#593F16",
            navigationSurface: "#BD9149",
            selected: "#79C4B5",
            selectedSurface: "#36766B",
            selectedText: "#183D36",
            text: "#F0CFB0",
            muted: "#D1AF99",
            border: "#CE8B78",
            danger: "#E46F75"
        }
    },
    {
        name: "Blueberry Sand",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#414A79",
            panel: "#56618E",
            panelAlt: "#6975A2",
            navigation: "#D8A96A",
            navigationText: "#563D1D",
            navigationSurface: "#B8894F",
            selected: "#81C7B1",
            selectedSurface: "#3C7867",
            selectedText: "#193E35",
            text: "#E7D1AD",
            muted: "#C8B899",
            border: "#B99A6C",
            danger: "#E0787A"
        }
    },
    {
        name: "Sage Berry",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#496452",
            panel: "#5F7B65",
            panelAlt: "#739078",
            navigation: "#C77B9B",
            navigationText: "#542C3D",
            navigationSurface: "#A75D7A",
            selected: "#DDB65C",
            selectedSurface: "#957729",
            selectedText: "#473911",
            text: "#D9D3A8",
            muted: "#BEB993",
            border: "#9FAB72",
            danger: "#DC7470"
        }
    },
    {
        name: "Violet Copper",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#533B71",
            panel: "#6B4F88",
            panelAlt: "#80639D",
            navigation: "#D98B57",
            navigationText: "#5B3019",
            navigationSurface: "#B96B3D",
            selected: "#78C8BA",
            selectedSurface: "#34766B",
            selectedText: "#193D37",
            text: "#E7C3A3",
            muted: "#C7A98F",
            border: "#C47F5D",
            danger: "#E4777B"
        }
    },
    {
        name: "Petrol Amber",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#264D57",
            panel: "#34646E",
            panelAlt: "#447B84",
            navigation: "#DDA44B",
            navigationText: "#533B12",
            navigationSurface: "#B98234",
            selected: "#D585A5",
            selectedSurface: "#8A4260",
            selectedText: "#482131",
            text: "#E5C879",
            muted: "#C5AF68",
            border: "#B18F4E",
            danger: "#DE7771"
        }
    },
    {
        name: "Rust & Jade",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#6D3F30",
            panel: "#875442",
            panelAlt: "#9E6955",
            navigation: "#66B7A1",
            navigationText: "#244C42",
            navigationSurface: "#4C967F",
            selected: "#E0B95E",
            selectedSurface: "#92762B",
            selectedText: "#463810",
            text: "#CDE2B1",
            muted: "#AFBF98",
            border: "#8FB37D",
            danger: "#DD716D"
        }
    },

    {
        name: "Turquoise Sand",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#2D6F73",
            panel: "#3A8588",
            panelAlt: "#4A9B9D",
            navigation: "#E7C978",
            navigationText: "#5B4A18",
            navigationSurface: "#C6A956",
            selected: "#D77FA7",
            selectedSurface: "#8A4868",
            selectedText: "#452333",
            text: "#F0D9A8",
            muted: "#C8BE92",
            border: "#D0B15E",
            danger: "#E27072"
        }
    },
    {
        name: "Cherry Mint",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#773447",
            panel: "#91465B",
            panelAlt: "#A95B70",
            navigation: "#77C8AE",
            navigationText: "#245143",
            navigationSurface: "#56A990",
            selected: "#E8B95E",
            selectedSurface: "#98762A",
            selectedText: "#4A3910",
            text: "#CDE8D6",
            muted: "#AED0BC",
            border: "#8DBDA0",
            danger: "#E17474"
        }
    },
    {
        name: "Cyan Plum",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#245B69",
            panel: "#317384",
            panelAlt: "#408B9C",
            navigation: "#B88AD0",
            navigationText: "#492957",
            navigationSurface: "#986AB1",
            selected: "#E9C765",
            selectedSurface: "#9A7B2B",
            selectedText: "#4B3B10",
            text: "#D7C4E4",
            muted: "#B7A8C4",
            border: "#9D78B4",
            danger: "#E57D7D"
        }
    },
    {
        name: "Amber Teal",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#6D5426",
            panel: "#846A35",
            panelAlt: "#9C8145",
            navigation: "#5DB7AF",
            navigationText: "#234E49",
            navigationSurface: "#45968F",
            selected: "#D986B8",
            selectedSurface: "#8A4769",
            selectedText: "#482435",
            text: "#D6E5C5",
            muted: "#B7C3A7",
            border: "#89A47A",
            danger: "#E7786B"
        }
    },
    {
        name: "Magenta Brass",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#70315F",
            panel: "#8A4275",
            panelAlt: "#A1558A",
            navigation: "#D6B055",
            navigationText: "#533F13",
            navigationSurface: "#B58F3D",
            selected: "#72C2B0",
            selectedSurface: "#357468",
            selectedText: "#173D36",
            text: "#E9CC98",
            muted: "#C6B18A",
            border: "#C49A50",
            danger: "#E47078"
        }
    },
    {
        name: "Sky Clay",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#466D8A",
            panel: "#5A83A0",
            panelAlt: "#6E99B4",
            navigation: "#C97D61",
            navigationText: "#522E23",
            navigationSurface: "#AA624A",
            selected: "#E2BD63",
            selectedSurface: "#93752B",
            selectedText: "#47380F",
            text: "#F0D0B8",
            muted: "#CBB29F",
            border: "#B98973",
            danger: "#E27670"
        }
    },
    {
        name: "Jade Violet",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#3F6D5C",
            panel: "#527F6D",
            panelAlt: "#67937F",
            navigation: "#AA87C9",
            navigationText: "#432954",
            navigationSurface: "#8D6AAC",
            selected: "#E4BC62",
            selectedSurface: "#96752A",
            selectedText: "#48380F",
            text: "#DCCFE8",
            muted: "#BCB0C7",
            border: "#9D81B0",
            danger: "#E27C7C"
        }
    },
    {
        name: "Rose Teal",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#7B4658",
            panel: "#925A6C",
            panelAlt: "#AA6E80",
            navigation: "#6FC0B2",
            navigationText: "#255046",
            navigationSurface: "#53A292",
            selected: "#E7BE66",
            selectedSurface: "#97762C",
            selectedText: "#493910",
            text: "#D9E5D1",
            muted: "#B9C7B2",
            border: "#90B99E",
            danger: "#E47476"
        }
    },
    {
        name: "Azure Gold",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#305E9B",
            panel: "#4175B2",
            panelAlt: "#558BC8",
            navigation: "#E0B34F",
            navigationText: "#523E10",
            navigationSurface: "#BD9138",
            selected: "#C982B2",
            selectedSurface: "#814663",
            selectedText: "#432333",
            text: "#E8D79C",
            muted: "#C5B989",
            border: "#C8A04B",
            danger: "#E57679"
        }
    },
    {
        name: "Forest Rose",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#3C6647",
            panel: "#4E7A5A",
            panelAlt: "#628F6E",
            navigation: "#D2849C",
            navigationText: "#562E3C",
            navigationSurface: "#B1647C",
            selected: "#E6BF63",
            selectedSurface: "#96772B",
            selectedText: "#493910",
            text: "#E6D8A9",
            muted: "#C1B78F",
            border: "#A39D67",
            danger: "#E27471"
        }
    },
    {
        name: "Coral Navy",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#294E73",
            panel: "#386186",
            panelAlt: "#4B769B",
            navigation: "#E18A72",
            navigationText: "#5D3025",
            navigationSurface: "#BE6852",
            selected: "#E4C160",
            selectedSurface: "#96772A",
            selectedText: "#49390F",
            text: "#F0D1C1",
            muted: "#C9B3A8",
            border: "#B98B78",
            danger: "#E67470"
        }
    },
    {
        name: "Mint Bronze",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#4A756B",
            panel: "#5D897E",
            panelAlt: "#719D91",
            navigation: "#C68B5B",
            navigationText: "#4F301D",
            navigationSurface: "#A66C42",
            selected: "#D48FB0",
            selectedSurface: "#844B67",
            selectedText: "#432535",
            text: "#E8D3B0",
            muted: "#C5B69A",
            border: "#B68B69",
            danger: "#E07873"
        }
    },
    {
        name: "Purple Moss",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#5B476A",
            panel: "#6F5A7F",
            panelAlt: "#846E94",
            navigation: "#8EAA67",
            navigationText: "#35421F",
            navigationSurface: "#718C4D",
            selected: "#E0B55E",
            selectedSurface: "#93722A",
            selectedText: "#47370F",
            text: "#D9E1B3",
            muted: "#B9C09A",
            border: "#9DAA72",
            danger: "#E47A78"
        }
    },
    {
        name: "Burnt Orange Blue",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#8A4F2F",
            panel: "#A2633F",
            panelAlt: "#B97A52",
            navigation: "#70A7D0",
            navigationText: "#25475F",
            navigationSurface: "#5788AE",
            selected: "#7BC5B4",
            selectedSurface: "#397568",
            selectedText: "#193D36",
            text: "#D5E2EE",
            muted: "#B6C5D1",
            border: "#8FAFC4",
            danger: "#E46E6E"
        }
    },
    {
        name: "Royal Mint",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#4C4F8D",
            panel: "#6165A2",
            panelAlt: "#777AB7",
            navigation: "#83C8B0",
            navigationText: "#2B5046",
            navigationSurface: "#65A990",
            selected: "#E0B964",
            selectedSurface: "#94752C",
            selectedText: "#483910",
            text: "#D7E8DF",
            muted: "#B7C8C0",
            border: "#8FB5A3",
            danger: "#E47A80"
        }
    },
    {
        name: "Cinnamon Sea",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#76513C",
            panel: "#8D6650",
            panelAlt: "#A37B64",
            navigation: "#64B8B6",
            navigationText: "#224B4A",
            navigationSurface: "#499898",
            selected: "#D7A8C9",
            selectedSurface: "#844D76",
            selectedText: "#43263A",
            text: "#CFE5DC",
            muted: "#B0C6BD",
            border: "#87B5A9",
            danger: "#E2756F"
        }
    },
    {
        name: "Teal Lavender",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#3E6F78",
            panel: "#50848D",
            panelAlt: "#6399A2",
            navigation: "#B79AD6",
            navigationText: "#452D55",
            navigationSurface: "#977AB7",
            selected: "#E4BC62",
            selectedSurface: "#94752B",
            selectedText: "#48390F",
            text: "#DDD0E9",
            muted: "#BFB2CB",
            border: "#A68DBB",
            danger: "#E57D80"
        }
    },
    {
        name: "Brick Aqua",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#7D443E",
            panel: "#965851",
            panelAlt: "#AD6D66",
            navigation: "#65BFC0",
            navigationText: "#214D4D",
            navigationSurface: "#499FA1",
            selected: "#E6BE63",
            selectedSurface: "#96772B",
            selectedText: "#49390F",
            text: "#CFE7E1",
            muted: "#B0C7C1",
            border: "#88B8B2",
            danger: "#E3746D"
        }
    },
    {
        name: "Mustard Plum",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#77662D",
            panel: "#8F7D3D",
            panelAlt: "#A59550",
            navigation: "#A06FAF",
            navigationText: "#3F2847",
            navigationSurface: "#815690",
            selected: "#69BFB2",
            selectedSurface: "#34756A",
            selectedText: "#183D37",
            text: "#DDCFDF",
            muted: "#BEB0C0",
            border: "#9E85A6",
            danger: "#E77D71"
        }
    },
    {
        name: "Orchid Sea",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#5F4B7B",
            panel: "#745F91",
            panelAlt: "#8A74A6",
            navigation: "#61B5B2",
            navigationText: "#224A49",
            navigationSurface: "#489592",
            selected: "#E3B85D",
            selectedSurface: "#947329",
            selectedText: "#47370F",
            text: "#CFE4E2",
            muted: "#B0C5C3",
            border: "#86B0AE",
            danger: "#E37A80"
        }
    },
    {
        name: "Lime Denim",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#4E6682",
            panel: "#617A96",
            panelAlt: "#758FAA",
            navigation: "#A9C65A",
            navigationText: "#3A4518",
            navigationSurface: "#899F40",
            selected: "#D887AF",
            selectedSurface: "#864962",
            selectedText: "#452433",
            text: "#DDE8C0",
            muted: "#BBC89E",
            border: "#A3B572",
            danger: "#E37A76"
        }
    },
    {
        name: "Peach Teal",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#A7654F",
            panel: "#BC7A64",
            panelAlt: "#D09079",
            navigation: "#5BAEA6",
            navigationText: "#214743",
            navigationSurface: "#438E87",
            selected: "#D29BC3",
            selectedSurface: "#804C73",
            selectedText: "#41263A",
            text: "#DCE8D5",
            muted: "#BCC9B5",
            border: "#8CB8A6",
            danger: "#E36F6C"
        }
    },
    {
        name: "Blue Rose Gold",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#3B5B87",
            panel: "#4E6F9C",
            panelAlt: "#6384B1",
            navigation: "#D69A83",
            navigationText: "#563529",
            navigationSurface: "#B77B66",
            selected: "#DDB95F",
            selectedSurface: "#91732A",
            selectedText: "#46370F",
            text: "#ECD0C5",
            muted: "#C8B2AA",
            border: "#B89080",
            danger: "#E77776"
        }
    },
    {
        name: "Fern Coral",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#53704A",
            panel: "#67845D",
            panelAlt: "#7C9872",
            navigation: "#DA806C",
            navigationText: "#562E25",
            navigationSurface: "#B96250",
            selected: "#72BAB4",
            selectedSurface: "#36726F",
            selectedText: "#193B39",
            text: "#E7D9B3",
            muted: "#C3B994",
            border: "#A2A773",
            danger: "#E3746E"
        }
    },
    {
        name: "Graphite Gold",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#4A4F57",
            panel: "#5C626B",
            panelAlt: "#6F7680",
            navigation: "#D3A94F",
            navigationText: "#514012",
            navigationSurface: "#B08838",
            selected: "#78BFC3",
            selectedSurface: "#3A7377",
            selectedText: "#1B3A3C",
            text: "#E4D39B",
            muted: "#C3B78A",
            border: "#AE985C",
            danger: "#E37875"
        }
    },
    {
        name: "Berry Aqua",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#6C3E68",
            panel: "#82517E",
            panelAlt: "#996594",
            navigation: "#63BDBA",
            navigationText: "#214C4B",
            navigationSurface: "#499D9A",
            selected: "#E4B962",
            selectedSurface: "#95742A",
            selectedText: "#48380F",
            text: "#D0E5E2",
            muted: "#B1C6C3",
            border: "#88B5B2",
            danger: "#E47A7B"
        }
    },
    {
        name: "Olive Orchid",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#66643A",
            panel: "#7A784D",
            panelAlt: "#8F8D61",
            navigation: "#B080C3",
            navigationText: "#44294F",
            navigationSurface: "#9165A4",
            selected: "#68B9B3",
            selectedSurface: "#36716C",
            selectedText: "#193A37",
            text: "#DDD1E3",
            muted: "#BDB0C2",
            border: "#9C89A7",
            danger: "#E57B73"
        }
    },
    {
        name: "Aqua Bronze",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#43777B",
            panel: "#568C8F",
            panelAlt: "#6AA1A4",
            navigation: "#C78B5A",
            navigationText: "#4F301C",
            navigationSurface: "#A66D42",
            selected: "#D891B7",
            selectedSurface: "#854C6A",
            selectedText: "#432536",
            text: "#E7D2AF",
            muted: "#C4B599",
            border: "#B48B6A",
            danger: "#E17774"
        }
    },
    {
        name: "Sunflower Blue",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#5B6F91",
            panel: "#6F82A4",
            panelAlt: "#8497B8",
            navigation: "#DDB74F",
            navigationText: "#51410F",
            navigationSurface: "#BB9638",
            selected: "#D184A8",
            selectedSurface: "#81475F",
            selectedText: "#422330",
            text: "#E8D99F",
            muted: "#C5BA8B",
            border: "#C2A151",
            danger: "#E57B79"
        }
    },
    {
        name: "Paprika Mint",
        author: "PiPedal MultiFX",
        version: 1,
        colors: {
            background: "#914C3D",
            panel: "#A96050",
            panelAlt: "#C17665",
            navigation: "#6CBCA9",
            navigationText: "#254C43",
            navigationSurface: "#509D8B",
            selected: "#D19ABD",
            selectedSurface: "#7E4C70",
            selectedText: "#402639",
            text: "#D9E7D7",
            muted: "#B9C8B8",
            border: "#8CB8A0",
            danger: "#E36D6A"
        }
    },
];

const THEME_STORAGE_KEY = "pipedal-multifx-theme-v1";
const CUSTOM_THEMES_STORAGE_KEY = "pipedal-multifx-custom-themes-v1";
export const MULTIFX_THEME_CHANGED_EVENT = "multifx-theme-changed";

export const MFX_COLORS = {
    background: "var(--mfx-bg)",
    panel: "var(--mfx-panel)",
    panelAlt: "var(--mfx-panel-alt)",
    purple: "var(--mfx-purple)",
    purpleLight: "var(--mfx-purple-light)",
    purpleSurface: "var(--mfx-purple-surface)",
    cyan: "var(--mfx-cyan)",
    cyanSurface: "var(--mfx-cyan-surface)",
    cyanText: "var(--mfx-cyan-text)",
    text: "var(--mfx-text)",
    muted: "var(--mfx-muted)",
    border: "var(--mfx-border)",
    danger: "var(--mfx-danger)"
} as const;

export const MFX_HEADER_HEIGHT = 56;

function isHexColor(value: unknown): value is string {
    return typeof value === "string"
        && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function validateMultiFXTheme(
    value: unknown
): MultiFXThemeDefinition | undefined {
    if (!value || typeof value !== "object") return undefined;

    const source = value as Record<string, unknown>;
    const colors = source.colors as Record<string, unknown> | undefined;

    if (
        typeof source.name !== "string"
        || typeof source.author !== "string"
        || typeof source.version !== "number"
        || !colors
    ) {
        return undefined;
    }

    const required = [
        "background",
        "panel",
        "panelAlt",
        "navigation",
        "navigationText",
        "navigationSurface",
        "selected",
        "selectedSurface",
        "selectedText",
        "text",
        "muted",
        "border",
        "danger"
    ];

    for (const key of required) {
        if (!isHexColor(colors[key])) return undefined;
    }

    return value as MultiFXThemeDefinition;
}

export function loadMultiFXTheme(): MultiFXThemeDefinition {
    try {
        const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
        if (stored) {
            const parsed = validateMultiFXTheme(JSON.parse(stored));
            if (parsed) return parsed;
        }
    } catch {
        // Fall through to default.
    }

    return BUILT_IN_THEMES[0];
}

export function saveMultiFXTheme(theme: MultiFXThemeDefinition): boolean {
    const valid = validateMultiFXTheme(theme);
    if (!valid) return false;

    window.localStorage.setItem(
        THEME_STORAGE_KEY,
        JSON.stringify(valid, null, 2)
    );
    applyMultiFXTheme(valid);
    window.dispatchEvent(new Event(MULTIFX_THEME_CHANGED_EVENT));
    return true;
}


export function loadCustomMultiFXThemes(): MultiFXThemeDefinition[] {
    try {
        const stored = window.localStorage.getItem(
            CUSTOM_THEMES_STORAGE_KEY
        );

        if (!stored) return [];

        const parsed = JSON.parse(stored);
        if (!Array.isArray(parsed)) return [];

        return parsed
            .map((item) => validateMultiFXTheme(item))
            .filter(
                (item): item is MultiFXThemeDefinition =>
                    item !== undefined
            );
    } catch {
        return [];
    }
}

export function saveCustomMultiFXTheme(
    theme: MultiFXThemeDefinition
): MultiFXThemeDefinition[] {
    const valid = validateMultiFXTheme(theme);
    if (!valid) {
        return loadCustomMultiFXThemes();
    }

    const current = loadCustomMultiFXThemes();

    // Custom theme names are unique, case-insensitively. Saving the same
    // name updates that custom theme rather than creating duplicates.
    const filtered = current.filter(
        (item) =>
            item.name.trim().toLowerCase()
            !== valid.name.trim().toLowerCase()
    );

    const next = [
        ...filtered,
        JSON.parse(JSON.stringify(valid)) as MultiFXThemeDefinition
    ].sort((a, b) => a.name.localeCompare(b.name));

    window.localStorage.setItem(
        CUSTOM_THEMES_STORAGE_KEY,
        JSON.stringify(next, null, 2)
    );

    return next;
}

export function deleteCustomMultiFXTheme(
    name: string
): MultiFXThemeDefinition[] {
    const next = loadCustomMultiFXThemes().filter(
        (item) =>
            item.name.trim().toLowerCase()
            !== name.trim().toLowerCase()
    );

    window.localStorage.setItem(
        CUSTOM_THEMES_STORAGE_KEY,
        JSON.stringify(next, null, 2)
    );

    return next;
}

export function clearSavedMultiFXTheme(): void {
    window.localStorage.removeItem(THEME_STORAGE_KEY);
    applyMultiFXTheme(BUILT_IN_THEMES[0]);
    window.dispatchEvent(new Event(MULTIFX_THEME_CHANGED_EVENT));
}

export function applyMultiFXTheme(theme: MultiFXThemeDefinition): void {
    const c = theme.colors;
    const targets = [document.documentElement, document.body];

    for (const target of targets) {
        target.style.setProperty("--mfx-bg", c.background);
        target.style.setProperty("--mfx-panel", c.panel);
        target.style.setProperty("--mfx-panel-alt", c.panelAlt);
        target.style.setProperty("--mfx-purple", c.navigation);
        target.style.setProperty("--mfx-purple-light", c.navigationText);
        target.style.setProperty("--mfx-purple-surface", c.navigationSurface);
        target.style.setProperty("--mfx-cyan", c.selected);
        target.style.setProperty("--mfx-cyan-surface", c.selectedSurface);
        target.style.setProperty("--mfx-cyan-text", c.selectedText);
        target.style.setProperty("--mfx-text", c.text);
        target.style.setProperty("--mfx-muted", c.muted);
        target.style.setProperty("--mfx-border", c.border);
        target.style.setProperty("--mfx-danger", c.danger);
    }
}

export function clearAppliedMultiFXTheme(): void {
    const keys = [
        "--mfx-bg",
        "--mfx-panel",
        "--mfx-panel-alt",
        "--mfx-purple",
        "--mfx-purple-light",
        "--mfx-purple-surface",
        "--mfx-cyan",
        "--mfx-cyan-surface",
        "--mfx-cyan-text",
        "--mfx-text",
        "--mfx-muted",
        "--mfx-border",
        "--mfx-danger"
    ];

    for (const target of [document.documentElement, document.body]) {
        for (const key of keys) {
            target.style.removeProperty(key);
        }
    }
}
