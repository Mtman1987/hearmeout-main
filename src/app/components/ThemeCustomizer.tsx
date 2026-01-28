
'use client';

import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from '@/hooks/use-toast';

type Theme = {
  name: string;
  colors: {
    [key: string]: string;
  };
};

const defaultThemes: Theme[] = [
    {
        name: 'Dark',
        colors: {
            "background": "224 71% 4%",
            "foreground": "213 31% 91%",
            "primary": "250 50% 60%",
            "primary-foreground": "0 0% 100%",
            "secondary": "215 28% 17%",
            "secondary-foreground": "213 31% 91%",
            "muted": "215 28% 17%",
            "muted-foreground": "215 28% 52%",
            "accent": "195 80% 60%",
            "accent-foreground": "224 71% 4%",
            "destructive": "0 63% 31%",
            "destructive-foreground": "213 31% 91%",
            "border": "215 28% 17%",
            "input": "215 28% 17%",
            "ring": "195 80% 60%",
        }
    },
    {
        name: 'Light',
        colors: {
            "background": "0 0% 96.1%",
            "foreground": "240 10% 3.9%",
            "primary": "250 50% 60%",
            "primary-foreground": "0 0% 100%",
            "secondary": "240 67% 94%",
            "secondary-foreground": "240 5.9% 10%",
            "muted": "240 67% 94%",
            "muted-foreground": "0 0% 45.1%",
            "accent": "195 53% 79%",
            "accent-foreground": "240 5.9% 10%",
            "destructive": "0 84.2% 60.2%",
            "destructive-foreground": "0 0% 98%",
            "border": "0 0% 89.8%",
            "input": "0 0% 89.8%",
            "ring": "195 53% 79%",
        }
    }
];

const parseHsl = (hslStr: string) => {
    if (!hslStr) return { h: 0, s: 0, l: 0 };
    const [h, s, l] = hslStr.replace(/%/g, '').split(' ').map(parseFloat);
    return { h, s, l };
};

export function ThemeCustomizer() {
    const [themes, setThemes] = useState<Theme[]>([]);
    const [currentTheme, setCurrentTheme] = useState<Theme>(defaultThemes[0]);
    const [newThemeName, setNewThemeName] = useState('');
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
        const savedThemes = localStorage.getItem('custom-themes');
        const activeThemeName = localStorage.getItem('active-theme');
        let allThemes = [...defaultThemes];
        if (savedThemes) {
            allThemes = [...allThemes, ...JSON.parse(savedThemes)];
        }
        setThemes(allThemes);
        const activeTheme = allThemes.find(t => t.name === activeThemeName) || defaultThemes[0];
        setCurrentTheme(activeTheme);
    }, []);

    useEffect(() => {
        if(isMounted) {
            applyTheme(currentTheme);
            if (currentTheme.name !== 'Custom') {
                localStorage.setItem('active-theme', currentTheme.name);
            }
        }
    }, [currentTheme, isMounted]);

    const applyTheme = (theme: Theme) => {
        if (typeof window === 'undefined') return;
        const root = document.documentElement;
        if (theme.name.toLowerCase().includes('dark')) {
            root.classList.add('dark');
        } else {
            root.classList.remove('dark');
        }
        Object.entries(theme.colors).forEach(([name, value]) => {
            if (value) root.style.setProperty(`--${name}`, value);
        });
    };
    
    const hexToHsl = (hex: string) => {
        let r = 0, g = 0, b = 0;
        if (hex.length === 4) { r = parseInt(hex[1] + hex[1], 16); g = parseInt(hex[2] + hex[2], 16); b = parseInt(hex[3] + hex[3], 16); } else if (hex.length === 7) { r = parseInt(hex.substring(1, 3), 16); g = parseInt(hex.substring(3, 5), 16); b = parseInt(hex.substring(5, 7), 16); }
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0, s = 0, l = (max + min) / 2;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }
        return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
    };

    const hslToHex = (h: number, s: number, l: number) => {
        l /= 100;
        const a = s * Math.min(l, 1 - l) / 100;
        const f = (n: number) => {
            const k = (n + h / 30) % 12;
            const color = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
            return Math.round(255 * color).toString(16).padStart(2, '0');
        };
        return `#${f(0)}${f(8)}${f(4)}`;
    };

    const handleColorChange = (colorName: string, value: string) => {
        const hsl = hexToHsl(value);
        const hslString = `${hsl.h} ${hsl.s}% ${hsl.l}%`;
        const newColors = { ...currentTheme.colors, [colorName]: hslString };
        const updatedTheme = { ...currentTheme, name: 'Custom', colors: newColors };
        const customThemeIndex = themes.findIndex(t => t.name === 'Custom');
        let newThemes;
        if (customThemeIndex > -1) { newThemes = [...themes]; newThemes[customThemeIndex] = updatedTheme; } else { newThemes = [...themes, updatedTheme]; }
        setThemes(newThemes);
        setCurrentTheme(updatedTheme);
    };

    const handleSaveTheme = () => {
        if (!newThemeName.trim()) { toast({ variant: 'destructive', title: 'Error', description: 'Please enter a name for your theme.' }); return; }
        if (themes.some(t => t.name.toLowerCase() === newThemeName.trim().toLowerCase())) { toast({ variant: 'destructive', title: 'Error', description: 'A theme with this name already exists.' }); return; }
        const newTheme: Theme = { ...currentTheme, name: newThemeName.trim() };
        const updatedThemes = [...themes.filter(t => t.name !== 'Custom'), newTheme];
        setThemes(updatedThemes);
        setCurrentTheme(newTheme);
        const customThemes = updatedThemes.filter(t => !defaultThemes.find(dt => dt.name === t.name));
        localStorage.setItem('custom-themes', JSON.stringify(customThemes));
        setNewThemeName('');
        toast({ title: 'Theme Saved!', description: `Theme "${newThemeName}" has been saved.` });
    };

    if (!isMounted) return null;
    
    const ColorInput = ({ label, colorName }: { label: string, colorName: string }) => {
        const hslString = currentTheme.colors[colorName];
        const { h, s, l } = parseHsl(hslString);
        const hex = hslToHex(h, s, l);
        return (
             <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor={`${colorName}-color`} className="text-right">{label}</Label>
                <Input id={`${colorName}-color`} type="color" value={hex} onChange={(e) => handleColorChange(colorName, e.target.value)} className="col-span-3 p-1"/>
            </div>
        );
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Customize Theme</CardTitle>
                <CardDescription>Change the look and feel of the app. Your changes will be saved locally.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="theme-select" className="text-right">Preset</Label>
                    <Select value={currentTheme.name} onValueChange={(themeName) => { const theme = themes.find(t => t.name === themeName); if (theme) setCurrentTheme(theme); }}>
                        <SelectTrigger id="theme-select" className="col-span-3"><SelectValue placeholder="Select a theme" /></SelectTrigger>
                        <SelectContent>{themes.map((theme) => (<SelectItem key={theme.name} value={theme.name}>{theme.name}</SelectItem>))}</SelectContent>
                    </Select>
                </div>
                <ColorInput label="Background" colorName="background" />
                <ColorInput label="Primary" colorName="primary" />
                <ColorInput label="Accent" colorName="accent" />
            </CardContent>
            <CardFooter>
                <div className="flex w-full gap-2">
                     <Input placeholder="Save as new theme..." value={newThemeName} onChange={(e) => setNewThemeName(e.target.value)} />
                    <Button onClick={handleSaveTheme}>Save</Button>
                </div>
            </CardFooter>
        </Card>
    );
}
