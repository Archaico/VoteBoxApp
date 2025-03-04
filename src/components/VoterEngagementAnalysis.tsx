import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DownloadCloud, FileJson, FileText, Calendar, Loader2, Check, AlertCircle } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from '@/components/ui/dropdown-menu';
import { Alert, AlertDescription } from '@/components/ui/alert';

// Analytics Export Component
const AnalyticsExport = ({ engagementData, timeRange }) => {
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState(null);

  const formatDateForFilename = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

  const prepareExportData = () => {
    return {
      timeRange,
      exportDate: new Date().toISOString(),
      votingPatterns: engagementData.votingPatterns,
      topProposals: engagementData.topProposals,
    };
  };

  // Clear export status after 3 seconds
  useEffect(() => {
    if (exportStatus) {
      const timer = setTimeout(() => {
        setExportStatus(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [exportStatus]);

  const exportToCSV = async () => {
    try {
      setIsExporting(true);
      const data = prepareExportData();
      
      // Convert voting patterns to CSV
      const votingPatternsCSV = [
        ['Category', 'Percentage'],
        ...data.votingPatterns.map(pattern => [pattern.name, pattern.value])
      ];

      // Convert top proposals to CSV
      const topProposalsCSV = [
        ['Title', 'Engagement'],
        ...data.topProposals.map(proposal => [proposal.title, proposal.engagement])
      ];

      // Combine into a single CSV string
      const csvContent = [
        `Voting Analytics Export - ${timeRange}`,
        `Export Date: ${data.exportDate}`,
        '',
        'Voting Patterns:',
        ...votingPatternsCSV.map(row => row.join(',')),
        '',
        'Top Proposals:',
        ...topProposalsCSV.map(row => row.join(','))
      ].join('\n');

      // Create and download file
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `voting-analytics-${formatDateForFilename()}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      setExportStatus({ success: true, message: 'CSV exported successfully' });
    } catch (error) {
      setExportStatus({ success: false, message: 'Failed to export CSV' });
    } finally {
      setIsExporting(false);
    }
  };

  const exportToJSON = async () => {
    try {
      setIsExporting(true);
      const data = prepareExportData();
      
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `voting-analytics-${formatDateForFilename()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      setExportStatus({ success: true, message: 'JSON exported successfully' });
    } catch (error) {
      setExportStatus({ success: false, message: 'Failed to export JSON' });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="relative">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="gap-2">
            {isExporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <DownloadCloud className="h-4 w-4" />
            )}
            Export Data
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            {timeRange} Data
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={exportToCSV} disabled={isExporting}>
            <FileText className="h-4 w-4 mr-2" />
            Export as CSV
          </DropdownMenuItem>
          <DropdownMenuItem onClick={exportToJSON} disabled={isExporting}>
            <FileJson className="h-4 w-4 mr-2" />
            Export as JSON
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {exportStatus && (
        <div className="absolute top-12 right-0 w-64 mt-2">
          <Alert variant={exportStatus.success ? "default" : "destructive"}>
            <div className="flex items-center gap-2">
              {exportStatus.success ? (
                <Check className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              <AlertDescription>
                {exportStatus.message}
              </AlertDescription>
            </div>
          </Alert>
        </div>
      )}
    </div>
  );
};

// Main VoterEngagementAnalysis Component
const VoterEngagementAnalysis = () => {
  // ... [Rest of the component remains exactly the same]
};

export default VoterEngagementAnalysis;